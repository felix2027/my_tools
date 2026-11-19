"""Daily additive rule backup: never delete historical files or change legacy paths."""
import os
import sys
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path, PurePosixPath

import requests
import yaml

CONFIG_FILE = 'download_config.yaml'
REQUEST_TIMEOUT = (10, 60)


def _missing_upstream(error):
    """A missing upstream is expected for an archive, unlike network/server errors."""
    response = getattr(error, 'response', None)
    return response is not None and response.status_code in (404, 410)


def _relative_path(value):
    return (isinstance(value, str) and '\\' not in value and ':' not in value
            and '\x00' not in value and all(part not in ('', '.', '..')
                                            for part in value.split('/')))


def get_github_api_files(repo, folder, branch, token, exclude_dirs=()):
    """List one source completely before releasing any of its download tasks."""
    api_url = f'https://api.github.com/repos/{repo}/contents/{folder}?ref={branch}'
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
    }
    all_files = []

    def fetch_recursive(url, parent):
        with requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT) as response:
            response.raise_for_status()
            contents = response.json()
        if not isinstance(contents, list):
            raise ValueError('GitHub API did not return a directory listing')
        for item in contents:
            if not isinstance(item, dict) or 'type' not in item:
                raise ValueError('Invalid item in GitHub directory listing')
            name = item.get('name')
            if not _relative_path(name) or '/' in name:
                raise ValueError('Invalid name in GitHub directory listing')
            relative_path = (parent / name).as_posix()
            if item['type'] == 'file':
                if not isinstance(item.get('download_url'), str) or not item['download_url']:
                    raise ValueError('GitHub file has no usable download URL')
                all_files.append((relative_path, item['download_url']))
            elif item['type'] == 'dir' and relative_path not in exclude_dirs:
                if not isinstance(item.get('url'), str) or not item['url']:
                    raise ValueError('GitHub directory has no usable API URL')
                time.sleep(1)
                fetch_recursive(item['url'], parent / name)

    fetch_recursive(api_url, PurePosixPath())
    return all_files


def download_file(url, destinations):
    """Fetch once. Finish and close every temporary copy before replacing files."""
    print(f"Downloading {destinations[0]}...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/121.0.0.0 Safari/537.36',
    }
    with ExitStack() as cleanup:
        with requests.get(url, headers=headers, stream=True, timeout=REQUEST_TIMEOUT) as response:
            response.raise_for_status()
            copies = []
            with ExitStack() as handles:
                for destination in destinations:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    temporary = handles.enter_context(tempfile.NamedTemporaryFile(
                        mode='wb', dir=destination.parent, prefix='.download-',
                        suffix='.tmp', delete=False))
                    copies.append(temporary)
                    cleanup.callback(Path(temporary.name).unlink, missing_ok=True)
                for chunk in response.iter_content(chunk_size=8192):
                    for temporary in copies:
                        temporary.write(chunk)
                for temporary in copies:
                    temporary.flush()
                    os.fsync(temporary.fileno())
        for temporary, destination in zip(copies, destinations):
            os.replace(temporary.name, destination)


def _validate_config(config):
    if not isinstance(config, dict):
        raise ValueError('Configuration must be a mapping')
    sections = {
        'files': ('filename', 'url', 'download_location'),
        'folders': ('github_repo', 'folder_path', 'file_extension', 'backup_location'),
    }
    for section, required in sections.items():
        entries = config.get(section, [])
        if not isinstance(entries, list):
            raise ValueError(f"'{section}' must be a list")
        for index, entry in enumerate(entries):
            # Empty source folder means repository root; empty extension matches all.
            allow_empty = {'folder_path', 'file_extension'}
            if not isinstance(entry, dict) or not all(
                    isinstance(entry.get(key), str) and
                    (entry[key] or key in allow_empty) for key in required):
                raise ValueError(f"Invalid {section} entry #{index + 1}")
    for branch in [config.get('branch', 'main')] + [
            item.get('branch', config.get('branch', 'main'))
            for item in config.get('folders', [])]:
        if not isinstance(branch, str) or not branch:
            raise ValueError('Branch must be a nonempty string')
    for folder in config.get('folders', []):
        for key in ('exclude_dirs', 'legacy_aliases'):
            paths = folder.get(key, [])
            if not isinstance(paths, list) or not all(_relative_path(path) for path in paths):
                raise ValueError(f"Invalid {key} in folder configuration")
        if folder.get('legacy_aliases') and not (
                isinstance(folder.get('legacy_location'), str) and folder['legacy_location']):
            raise ValueError('Legacy aliases need a destination directory')


def plan_downloads(config, token):
    tasks = [(item['url'], [Path(item['download_location']) / item['filename']])
             for item in config.get('files', [])]
    failures = 0
    for folder in config.get('folders', []):
        try:
            listing = get_github_api_files(
                folder['github_repo'], folder['folder_path'],
                folder.get('branch', config.get('branch', 'main')), token,
                folder.get('exclude_dirs', []))
        except (requests.RequestException, ValueError) as error:
            print(f"Skipped {folder['github_repo']}/{folder['folder_path']}: "
                  f"{type(error).__name__}. Retained its historical backups.")
            failures += 1
            continue
        aliases = set(folder.get('legacy_aliases', []))
        for relative_path, url in listing:
            if relative_path.endswith(folder['file_extension']):
                destinations = [Path(folder['backup_location']) / relative_path]
                if relative_path in aliases:
                    destinations.append(Path(folder['legacy_location']) / Path(relative_path).name)
                tasks.append((url, destinations))
    claimed = set()
    for _, destinations in tasks:
        for path in destinations:
            key = path.resolve()
            if key in claimed:
                raise ValueError(f"Multiple writes planned for {path}")
            claimed.add(key)
    return tasks, failures


def main():
    github_token = os.getenv('GITHUB_API_TOKEN')
    if not github_token:
        print('Error: GITHUB_API_TOKEN environment variable not set.')
        return 1

    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as config_file:
            config = yaml.safe_load(config_file)
        _validate_config(config)
    except (OSError, yaml.YAMLError, ValueError) as error:
        # YAML error messages may contain source lines with credentials.
        print(f"Error reading configuration: {type(error).__name__}")
        return 1

    try:
        tasks, failures = plan_downloads(config, github_token)
    except ValueError as error:
        print(f"Invalid backup plan: {error}")
        return 1

    completed = []
    print(f"Planned {len(tasks)} downloads.")
    for url, destinations in tasks:
        try:
            download_file(url, destinations)
            completed.extend(destinations)
        except requests.RequestException as error:
            if _missing_upstream(error) and all(path.is_file() for path in destinations):
                print(f"Retained historical backup for {destinations[0]} (404/410).")
            else:
                print(f"Skipped {destinations[0]}: {type(error).__name__}")
                failures += 1
        except OSError as error:
            print(f"Error writing {destinations[0]}: {type(error).__name__}. Aborting publish.")
            return 1
        time.sleep(0.5)
    manifest = os.getenv('BACKUP_PATHS_FILE')
    if manifest:
        with open(manifest, 'wb') as output:
            for path in completed:
                output.write(os.fsencode(path.as_posix()) + b'\0')
    if failures:
        print(f"Partial backup: {failures} source(s) failed, {len(completed)} paths refreshed.")
        return 2
    print(f"Backup completed: {len(completed)} paths refreshed.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
