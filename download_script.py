"""Daily additive rule backup: never delete historical files or change legacy paths."""
import os
import sys
import tempfile
import time

import requests
import yaml

CONFIG_FILE = 'download_config.yaml'
REQUEST_TIMEOUT = (10, 60)


def _missing_upstream(error):
    """A missing upstream is expected for an archive, unlike network/server errors."""
    response = getattr(error, 'response', None)
    return response is not None and response.status_code in (404, 410)


def get_github_api_files(repo, folder, branch, token):
    """List the complete configured tree, preserving the existing traversal order.

    Raise on an incomplete listing so a partial API response is never treated as
    a complete successful backup. No local files are changed while listing.
    """
    api_url = f'https://api.github.com/repos/{repo}/contents/{folder}?ref={branch}'
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
    }
    all_files = []

    def fetch_recursive(url):
        with requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT) as response:
            response.raise_for_status()
            contents = response.json()
        if not isinstance(contents, list):
            raise ValueError('GitHub API did not return a directory listing')
        for item in contents:
            if not isinstance(item, dict) or 'type' not in item:
                raise ValueError('Invalid item in GitHub directory listing')
            if item['type'] == 'file':
                if not all(isinstance(item.get(k), str) and item[k]
                           for k in ('name', 'download_url')):
                    raise ValueError('GitHub file has no usable name/download URL')
                all_files.append(item)
            elif item['type'] == 'dir':
                if not isinstance(item.get('url'), str) or not item['url']:
                    raise ValueError('GitHub directory has no usable API URL')
                time.sleep(1)
                fetch_recursive(item['url'])

    fetch_recursive(api_url)
    return all_files


def download_file(url, destination_path):
    """Replace only after a complete download; preserve old data on every failure."""
    temporary_path = None
    try:
        # Do not log subscription URLs or query parameters.
        print(f"Downloading {destination_path}...")
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/121.0.0.0 Safari/537.36',
        }
        with requests.get(url, headers=headers, stream=True,
                          timeout=REQUEST_TIMEOUT) as response:
            response.raise_for_status()
            directory = os.path.dirname(os.path.abspath(destination_path))
            os.makedirs(directory, exist_ok=True)
            # Same directory guarantees the replacement stays on the same volume.
            with tempfile.NamedTemporaryFile(
                    mode='wb', dir=directory, prefix='.download-', suffix='.tmp',
                    delete=False) as temporary:
                temporary_path = temporary.name
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        temporary.write(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
        os.replace(temporary_path, destination_path)
        temporary_path = None
        print(f"Successfully downloaded {os.path.basename(destination_path)}")
        return True
    except requests.exceptions.RequestException as error:
        if _missing_upstream(error) and os.path.isfile(destination_path):
            print(f"Warning: upstream removed/unavailable (404/410); retained "
                  f"historical backup {destination_path}")
            return True
        print(f"Error downloading {destination_path}: {type(error).__name__}")
        return False
    except (OSError, ValueError) as error:
        print(f"Error writing {destination_path}: {type(error).__name__}")
        return False
    finally:
        if temporary_path is not None:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
            except OSError:
                # Never remove the destination to compensate for cleanup failure.
                print(f"Warning: unable to remove temporary file {temporary_path}")


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

    files_to_download = list(config.get('files', []))
    default_branch = config.get('branch', 'main')
    try:
        for folder_conf in config.get('folders', []):
            api_files = get_github_api_files(
                folder_conf['github_repo'],
                folder_conf['folder_path'],
                folder_conf.get('branch', default_branch),
                github_token,
            )
            for file_info in api_files:
                if file_info['name'].endswith(folder_conf['file_extension']):
                    # Compatibility: preserve legacy URLs and traversal ordering.
                    # Do not silently switch existing flattened aliases to a
                    # different upstream file. Tree migration needs a separate plan.
                    files_to_download.append({
                        'filename': file_info['name'],
                        'url': file_info['download_url'],
                        'download_location': folder_conf['backup_location'],
                    })
    except (requests.exceptions.RequestException, ValueError) as error:
        print(f"Error listing upstream files: {type(error).__name__}; "
              "no downloads were started")
        return 1

    if not files_to_download:
        print('No files to download; existing historical backups retained.')
        return 0

    failures = 0
    print(f"Found a total of {len(files_to_download)} files to download.")
    for item in files_to_download:
        full_path = os.path.join(item['download_location'], item['filename'])
        if not download_file(item['url'], full_path):
            failures += 1
        time.sleep(0.5)
    if failures:
        print(f"Backup failed: {failures} download(s) failed; do not publish this run.")
        return 1
    print('Backup completed; no historical files were deleted.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
