"""Daily additive rule backup via git sparse-checkout: never delete historical files or change legacy paths."""
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from contextlib import ExitStack
from pathlib import Path

import requests
import yaml

CONFIG_FILE = 'download_config.yaml'
REQUEST_TIMEOUT = (10, 60)
GIT_TIMEOUT = 300
GIT_RETRIES = 3


def _missing_upstream(error):
    """A missing upstream is expected for an archive, unlike network/server errors."""
    response = getattr(error, 'response', None)
    return response is not None and response.status_code in (404, 410)


def _force_remove_readonly(func, path, _exc_info):
    """Allow rmtree to clean read-only .git packfiles on Windows as well as Linux."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def _rmtree(path):
    if Path(path).exists():
        shutil.rmtree(path, onerror=_force_remove_readonly)


def _relative_path(value):
    return (isinstance(value, str) and '\\' not in value and ':' not in value
            and '\x00' not in value and all(part not in ('', '.', '..')
                                            for part in value.split('/')))


def _valid_repo(value):
    if not _relative_path(value):
        return False
    parts = value.split('/')
    return (len(parts) == 2 and all(
        not part.startswith('-') and all(
            ch.isalnum() or ch in '._-' for ch in part)
        for part in parts))


def _valid_branch(value):
    return (isinstance(value, str) and bool(value)
            and not value.startswith('-') and '\\' not in value
            and '\x00' not in value and '..' not in value)


def _normalize_extensions(entry):
    ext = entry.get('file_extension', '')
    if isinstance(ext, str):
        return (ext,) if ext else ()
    if isinstance(ext, list) and ext and all(
            isinstance(item, str) and bool(item) for item in ext):
        return tuple(ext)
    raise ValueError('Invalid file_extension configuration')


def _minimal_sparse_paths(paths):
    """Collapse nested paths so git sparse-checkout fetches each subtree once."""
    if any(path == '' for path in paths):
        return None
    ordered = sorted({path.strip('/') for path in paths},
                     key=lambda p: (p.count('/'), p))
    minimal = []
    for path in ordered:
        if not any(path == root or path.startswith(root + '/')
                   for root in minimal):
            minimal.append(path)
    return minimal


def _run_git(args, cwd=None):
    env = os.environ.copy()
    env['GIT_TERMINAL_PROMPT'] = '0'
    subprocess.run(
        ['git', '-c', 'core.autocrlf=false', '-c', 'core.symlinks=false',
         '-c', 'core.longpaths=true', *args],
        cwd=cwd,
        env=env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=GIT_TIMEOUT,
    )


def clone_sparse_repo(repo, branch, sparse_paths, target_dir):
    """Clone only the requested directory trees at depth=1 without API quota consumption."""
    repo_url = f'https://github.com/{repo}.git'
    last_error = None
    for attempt in range(1, GIT_RETRIES + 1):
        _rmtree(target_dir)
        try:
            print(f"Cloning {repo}@{branch} (attempt {attempt}/{GIT_RETRIES})...")
            clone_args = [
                'clone', '--depth', '1', '--filter=blob:none',
                '--no-checkout', '--single-branch', '--branch', branch,
            ]
            if sparse_paths is not None:
                clone_args.append('--sparse')
            clone_args.extend(['--', repo_url, str(target_dir)])
            _run_git(clone_args)
            if sparse_paths is not None:
                _run_git(['sparse-checkout', 'set', '--cone', '--', *sparse_paths],
                         cwd=target_dir)
            _run_git(['checkout'], cwd=target_dir)
            return
        except (subprocess.SubprocessError, OSError) as error:
            last_error = error
            if attempt < GIT_RETRIES:
                time.sleep(2 * attempt)
    raise RuntimeError(f"Git clone failed for {repo}@{branch}: {last_error}")


def collect_folder_files(clone_root, folder):
    """Walk a sparse-checked-out folder and map matching files to backup + legacy paths."""
    folder_path = folder['folder_path'].strip('/')
    source_root = clone_root / folder_path if folder_path else clone_root
    if not source_root.is_dir():
        raise FileNotFoundError(
            f"Folder '{folder_path}' not found in {folder['github_repo']}")

    exclude_dirs = set(folder.get('exclude_dirs', []))
    extensions = _normalize_extensions(folder)
    aliases = set(folder.get('legacy_aliases', []))
    backup_base = Path(folder['backup_location'])
    legacy_base = (Path(folder['legacy_location'])
                   if folder.get('legacy_location') else None)

    planned = []
    for current_root, dirs, files in os.walk(source_root, followlinks=False):
        current_path = Path(current_root)
        kept_dirs = []
        for dirname in sorted(dirs):
            if dirname == '.git':
                continue
            dir_path = current_path / dirname
            if dir_path.is_symlink():
                continue
            rel_dir = dir_path.relative_to(source_root).as_posix()
            if rel_dir not in exclude_dirs:
                kept_dirs.append(dirname)
        dirs[:] = kept_dirs

        for filename in sorted(files):
            file_path = current_path / filename
            if file_path.is_symlink():
                continue
            rel_file = file_path.relative_to(source_root).as_posix()
            if extensions and not rel_file.endswith(extensions):
                continue
            destinations = [backup_base / rel_file]
            if rel_file in aliases and legacy_base is not None:
                destinations.append(legacy_base / Path(rel_file).name)
            planned.append((file_path, destinations))

    if not planned:
        raise ValueError(
            f"No matching files found in {folder['github_repo']}/{folder_path}")
    return planned


def _atomic_write(data_chunks, destinations):
    """Write stream/bytes to temporary siblings and atomically replace all destinations."""
    with ExitStack() as cleanup:
        copies = []
        with ExitStack() as handles:
            for destination in destinations:
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = handles.enter_context(tempfile.NamedTemporaryFile(
                    mode='wb', dir=destination.parent, prefix='.download-',
                    suffix='.tmp', delete=False))
                copies.append(temporary)
                cleanup.callback(Path(temporary.name).unlink, missing_ok=True)
            for chunk in data_chunks:
                for temporary in copies:
                    temporary.write(chunk)
            for temporary in copies:
                temporary.flush()
                os.fsync(temporary.fileno())
        for temporary, destination in zip(copies, destinations):
            os.replace(temporary.name, destination)


def download_file(url, destinations):
    """Fetch a standalone URL once and atomically replace its destinations."""
    print(f"Downloading {destinations[0]}...")
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/121.0.0.0 Safari/537.36',
    }
    with requests.get(url, headers=headers, stream=True, timeout=REQUEST_TIMEOUT) as response:
        response.raise_for_status()
        _atomic_write(response.iter_content(chunk_size=8192), destinations)


def copy_local_file(source_path, destinations):
    """Atomically update only destinations whose content differs from source_path."""
    data = source_path.read_bytes()
    size = len(data)
    pending = [
        dest for dest in destinations
        if not (dest.is_file() and dest.stat().st_size == size
                and dest.read_bytes() == data)
    ]
    if not pending:
        return False
    _atomic_write((data,), pending)
    return True


def _validate_config(config):
    if not isinstance(config, dict):
        raise ValueError('Configuration must be a mapping')

    files = config.get('files', [])
    if not isinstance(files, list):
        raise ValueError("'files' must be a list")
    for index, entry in enumerate(files):
        if (not isinstance(entry, dict)
                or not _relative_path(entry.get('filename'))
                or not isinstance(entry.get('url'), str) or not entry['url']
                or not isinstance(entry.get('download_location'), str)
                or not entry['download_location']):
            raise ValueError(f"Invalid files entry #{index + 1}")

    folders = config.get('folders', [])
    if not isinstance(folders, list):
        raise ValueError("'folders' must be a list")
    default_branch = config.get('branch', 'main')
    if not _valid_branch(default_branch):
        raise ValueError('Default branch must be a valid branch name')

    for index, folder in enumerate(folders):
        if not isinstance(folder, dict):
            raise ValueError(f"Invalid folders entry #{index + 1}")
        folder_path = folder.get('folder_path')
        if (not _valid_repo(folder.get('github_repo'))
                or not isinstance(folder_path, str)
                or (folder_path != '' and not _relative_path(folder_path.strip('/')))
                or not isinstance(folder.get('backup_location'), str)
                or not folder['backup_location']):
            raise ValueError(f"Invalid folders entry #{index + 1}")
        _normalize_extensions(folder)
        if not _valid_branch(folder.get('branch', default_branch)):
            raise ValueError(f"Invalid branch in folders entry #{index + 1}")
        for key in ('exclude_dirs', 'legacy_aliases'):
            paths = folder.get(key, [])
            if not isinstance(paths, list) or not all(_relative_path(path) for path in paths):
                raise ValueError(f"Invalid {key} in folder configuration")
        if folder.get('legacy_aliases') and not (
                isinstance(folder.get('legacy_location'), str)
                and folder['legacy_location']):
            raise ValueError('Legacy aliases need a destination directory')


def plan_backups(config, workspace):
    """Clone sparse repositories into workspace and verify zero destination collisions."""
    http_tasks = [
        (item['url'], [Path(item['download_location']) / item['filename']])
        for item in config.get('files', [])
    ]
    default_branch = config.get('branch', 'main')
    grouped_folders = defaultdict(list)
    for folder in config.get('folders', []):
        key = (folder['github_repo'], folder.get('branch', default_branch))
        grouped_folders[key].append(folder)

    copy_tasks = []
    failures = 0
    for index, ((repo, branch), repo_folders) in enumerate(grouped_folders.items()):
        clone_dir = workspace / f'repo_{index}'
        sparse_paths = _minimal_sparse_paths(
            [item['folder_path'] for item in repo_folders])
        try:
            clone_sparse_repo(repo, branch, sparse_paths, clone_dir)
        except RuntimeError as error:
            print(f"Skipped {repo}@{branch}: {error}. Retained historical backups.")
            failures += len(repo_folders)
            continue

        for folder in repo_folders:
            try:
                copy_tasks.extend(collect_folder_files(clone_dir, folder))
            except (OSError, ValueError) as error:
                print(f"Skipped {repo}/{folder['folder_path']}: "
                      f"{error}. Retained historical backups.")
                failures += 1

    claimed = set()
    for _, destinations in [*http_tasks, *copy_tasks]:
        for path in destinations:
            resolved = path.resolve()
            if resolved in claimed:
                raise ValueError(f"Multiple writes planned for {path}")
            claimed.add(resolved)
    return http_tasks, copy_tasks, failures


def main():
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as config_file:
            config = yaml.safe_load(config_file)
        _validate_config(config)
    except (OSError, yaml.YAMLError, ValueError) as error:
        # YAML error messages may contain source lines with credentials.
        print(f"Error reading configuration: {type(error).__name__}")
        return 1

    workspace = Path(tempfile.mkdtemp(prefix='rule-backup-'))
    try:
        try:
            http_tasks, copy_tasks, failures = plan_backups(config, workspace)
        except ValueError as error:
            print(f"Invalid backup plan: {error}")
            return 1

        completed = []
        updated_files = 0
        print(f"Planned {len(http_tasks)} HTTP file(s) and "
              f"{len(copy_tasks)} sparse-checkout file(s).")

        for url, destinations in http_tasks:
            try:
                download_file(url, destinations)
                completed.extend(destinations)
                updated_files += len(destinations)
            except requests.RequestException as error:
                if _missing_upstream(error) and all(path.is_file() for path in destinations):
                    print(f"Retained historical backup for {destinations[0]} (404/410).")
                else:
                    print(f"Skipped {destinations[0]}: {type(error).__name__}")
                    failures += 1
            except OSError as error:
                print(f"Error writing {destinations[0]}: {type(error).__name__}. Aborting publish.")
                return 1
            time.sleep(0.2)

        for source_path, destinations in copy_tasks:
            try:
                if copy_local_file(source_path, destinations):
                    updated_files += 1
                completed.extend(destinations)
            except OSError as error:
                print(f"Error writing {destinations[0]}: {type(error).__name__}. Aborting publish.")
                return 1

        manifest = os.getenv('BACKUP_PATHS_FILE')
        if manifest:
            with open(manifest, 'wb') as output:
                for path in completed:
                    output.write(os.fsencode(path.as_posix()) + b'\0')

        if failures:
            print(f"Partial backup: {failures} source(s) failed, "
                  f"{len(completed)} paths verified ({updated_files} updated).")
            return 2
        print(f"Backup completed: {len(completed)} paths verified "
              f"({updated_files} updated).")
        return 0
    finally:
        _rmtree(workspace)


if __name__ == '__main__':
    sys.exit(main())
