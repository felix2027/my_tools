import json
import os
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

import requests
import yaml

import download_script as backup


REPOSITORY = Path(backup.__file__).parent
RAW = 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/'
API = 'https://api.github.com/repos/ACL4SSR/ACL4SSR/contents/'


def file(path):
    return {'type': 'file', 'path': path, 'name': path.split('/')[-1],
            'download_url': RAW + path}


def directory(path):
    return {'type': 'dir', 'path': path, 'name': path.split('/')[-1],
            'url': API + path + '?ref=master'}


def folder(path, destination):
    return {'github_repo': 'ACL4SSR/ACL4SSR', 'branch': 'master',
            'folder_path': path, 'file_extension': '.list',
            'backup_location': destination}


class BackupDestinationsTest(unittest.TestCase):
    def setUp(self):
        workspace = tempfile.TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(workspace.name)

    def run_backup(self, config, listings, payloads, paths_file=None):
        Path('download_config.yaml').write_text(yaml.safe_dump(config), encoding='utf-8')
        self.requests = Counter()

        def get(url, **kwargs):
            path = unquote(urlsplit(url).path)
            if url.startswith(API):
                key = path.split('/contents/', 1)[1]
                value = listings[key]
            else:
                key = url
                value = payloads[url]
            self.requests[key] += 1
            if isinstance(value, Exception):
                raise value
            response = requests.Response()
            response.status_code = 200
            response.url = url
            response._content_consumed = True
            if callable(value):
                response.iter_content = value
            else:
                response._content = value if isinstance(value, bytes) else json.dumps(value).encode()
            return response

        environment = {'GITHUB_API_TOKEN': 'test'}
        if paths_file is not None:
            environment['BACKUP_PATHS_FILE'] = str(paths_file)
        with patch.dict(os.environ, environment, clear=True), \
                patch.object(requests, 'get', side_effect=get), \
                patch.object(backup.time, 'sleep'):
            return backup.main()

    def test_configured_aliases_and_canonical_paths_survive_new_name_collisions(self):
        config = yaml.safe_load((REPOSITORY / 'download_config.yaml').read_text(encoding='utf-8'))
        config['files'] = []
        root = Path('config/Ruleset/ACL4SSR')
        listings = {
            'Clash': [directory('Clash/Ruleset'), file('Clash/Bing.list'),
                      file('Clash/Telegram.list'), directory('Clash/New')],
            'Clash/Ruleset': [file('Clash/Ruleset/Bing.list'), file('Clash/Ruleset/Telegram.list')],
            'Clash/New': [file('Clash/New/Bing.list')],
        }
        payloads = {
            RAW + 'Clash/Bing.list': b'root bing',
            RAW + 'Clash/Telegram.list': b'root telegram',
            RAW + 'Clash/Ruleset/Bing.list': b'ruleset bing',
            RAW + 'Clash/Ruleset/Telegram.list': b'ruleset telegram',
            RAW + 'Clash/New/Bing.list': b'new bing',
        }
        self.assertEqual(self.run_backup(config, listings, payloads), 0)
        self.assertEqual(self.requests['Clash/Ruleset'], 1)
        for url in payloads:
            self.assertEqual(self.requests[url], 1, url)
        for name, expected in {
            'Bing.list': b'ruleset bing',
            'Telegram.list': b'root telegram',
            'Clash/Bing.list': b'root bing',
            'Clash/Telegram.list': b'root telegram',
            'Ruleset/Bing.list': b'ruleset bing',
            'Ruleset/Telegram.list': b'ruleset telegram',
            'Clash/New/Bing.list': b'new bing',
        }.items():
            with self.subTest(destination=name):
                self.assertEqual((root / name).read_bytes(), expected)

        listings['Clash/Ruleset'] = [file('Clash/Ruleset/Telegram.list')]
        payloads[RAW + 'Clash/Bing.list'] = b'new root version'
        self.assertEqual(self.run_backup(config, listings, payloads), 0)
        self.assertEqual((root / 'Bing.list').read_bytes(), b'ruleset bing')
        self.assertEqual((root / 'Ruleset/Bing.list').read_bytes(), b'ruleset bing')
        self.assertEqual((root / 'Clash/Bing.list').read_bytes(), b'new root version')

    def test_interrupted_download_preserves_all_copies_and_only_stages_successes(self):
        def interrupted_stream(chunk_size):
            yield b'incomplete bytes'
            raise requests.exceptions.ChunkedEncodingError()

        source = folder('Clash', 'tree')
        source.update(legacy_location='archive', legacy_aliases=['Bing.list', 'Good.list'])
        for parent in ['tree', 'archive']:
            Path(parent).mkdir()
            Path(parent, 'Bing.list').write_bytes(b'previous bing')
        paths_file = Path('staging-paths').resolve()
        config = {'folders': [source]}
        listings = {'Clash': [file('Clash/Bing.list'), file('Clash/Good.list')]}
        payloads = {RAW + 'Clash/Bing.list': interrupted_stream, RAW + 'Clash/Good.list': b'good'}
        self.assertEqual(self.run_backup(config, listings, payloads, paths_file), 2)
        for parent in ['tree', 'archive']:
            self.assertEqual(Path(parent, 'Bing.list').read_bytes(), b'previous bing')
            self.assertEqual(Path(parent, 'Good.list').read_bytes(), b'good')
        paths = paths_file.read_bytes().split(b'\0')
        self.assertEqual(paths.pop(), b'')
        self.assertCountEqual([Path(os.fsdecode(path)).as_posix() for path in paths],
                              ['tree/Good.list', 'archive/Good.list'])
        self.assertFalse(list(Path('.').rglob('.download-*.tmp')))

    def test_failed_subdirectory_preserves_source_and_allows_independent_updates(self):
        Path('bad').mkdir()
        Path('bad/Old.list').write_bytes(b'previous backup')
        standalone = 'https://example.test/standalone'
        config = {
            'files': [{'filename': 'Static.list', 'download_location': 'static', 'url': standalone}],
            'folders': [folder('Bad', 'bad'), folder('Good', 'good')],
        }
        listings = {
            'Bad': [file('Bad/Old.list'), directory('Bad/Unreadable')],
            'Bad/Unreadable': requests.ConnectionError(),
            'Good': [file('Good/Healthy.list')],
        }
        result = self.run_backup(config, listings, {
            standalone: b'updated standalone',
            RAW + 'Good/Healthy.list': b'updated folder',
        })
        self.assertEqual(result, 2)
        self.assertEqual(Path('bad/Old.list').read_bytes(), b'previous backup')
        self.assertEqual(Path('static/Static.list').read_bytes(), b'updated standalone')
        self.assertEqual(Path('good/Healthy.list').read_bytes(), b'updated folder')

    def test_conflicting_destinations_fail_without_replacing_historical_rule(self):
        Path('shared').mkdir()
        destination = Path('shared/Rule.list')
        destination.write_bytes(b'previous backup')
        config = {'folders': [folder('First', 'shared'), folder('Second', 'shared')]}
        listings = {'First': [file('First/Rule.list')], 'Second': [file('Second/Rule.list')]}
        payloads = {RAW + 'First/Rule.list': b'first', RAW + 'Second/Rule.list': b'second'}
        self.assertEqual(self.run_backup(config, listings, payloads), 1)
        self.assertEqual(destination.read_bytes(), b'previous backup')


if __name__ == '__main__':
    unittest.main()
