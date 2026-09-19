import yaml
import os
import requests
import time

# --- 配置 ---
CONFIG_FILE = 'download_config.yaml'

def get_github_api_files(repo, folder, branch, token):
    """使用 GitHub API 获取文件夹中的文件列表 (递归)"""
    api_url = f'https://api.github.com/repos/{repo}/contents/{folder}?ref={branch}'
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json'
    }
    
    all_files = []
    
    def fetch_recursive(url):
        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            contents = response.json()

            for item in contents:
                if item['type'] == 'file':
                    all_files.append(item)
                elif item['type'] == 'dir':
                    # 为了避免 API 速率限制，在递归调用前稍作延时
                    time.sleep(1)
                    fetch_recursive(item['url'])
        except requests.exceptions.RequestException as e:
            print(f"Error fetching from GitHub API ({url}): {e}")

    fetch_recursive(api_url)
    return all_files

def download_file(url, destination_path):
    """使用 requests 下载单个文件"""
    try:
        print(f"Downloading from {url} to {destination_path}...")
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'}
        response = requests.get(url, headers=headers, stream=True)
        response.raise_for_status()
        
        os.makedirs(os.path.dirname(destination_path), exist_ok=True)
        
        with open(destination_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"Successfully downloaded {os.path.basename(destination_path)}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error downloading {os.path.basename(destination_path)}: {e}")
        return False

def main():
    """主执行函数"""
    github_token = os.getenv('GITHUB_API_TOKEN')
    if not github_token:
        print("Error: GITHUB_API_TOKEN environment variable not set.")
        exit(1)

    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
    except FileNotFoundError:
        print(f"Error: Configuration file '{CONFIG_FILE}' not found.")
        exit(1)
    except yaml.YAMLError as e:
        print(f"Error parsing YAML file: {e}")
        exit(1)

    files_to_download = []
    default_branch = config.get('branch', 'main') # 提供一个默认值 'main'

    # 1. 处理 'files' 部分
    if 'files' in config and isinstance(config['files'], list):
        print("Processing individual files from 'files' section...")
        for file_conf in config['files']:
            if all(k in file_conf for k in ['filename', 'url', 'download_location']):
                files_to_download.append(file_conf)
            else:
                print(f"Warning: Skipping incomplete file config: {file_conf}")

    # 2. 处理 'folders' 部分
    if 'folders' in config and isinstance(config['folders'], list):
        print("Processing folder-based downloads from 'folders' section...")
        for folder_conf in config['folders']:
            if all(k in folder_conf for k in ['github_repo', 'folder_path', 'file_extension', 'backup_location']):
                branch = folder_conf.get('branch', default_branch)
                api_files = get_github_api_files(
                    folder_conf['github_repo'],
                    folder_conf['folder_path'],
                    branch,
                    github_token
                )
                for file_info in api_files:
                    if file_info['name'].endswith(folder_conf['file_extension']):
                        files_to_download.append({
                            'filename': file_info['name'],
                            'url': file_info['download_url'],
                            'download_location': folder_conf['backup_location']
                        })
            else:
                print(f"Warning: Skipping incomplete folder config: {folder_conf}")

    # 3. 执行下载
    if not files_to_download:
        print("No files to download based on the configuration.")
        return

    print(f"\nFound a total of {len(files_to_download)} files to download.")
    for item in files_to_download:
        full_path = os.path.join(item['download_location'], item['filename'])
        download_file(item['url'], full_path)
        # 每次下载后延时，避免对目标服务器造成过大压力
        time.sleep(0.5)

if __name__ == "__main__":
    main()
