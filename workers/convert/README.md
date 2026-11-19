## Bindings
|Type|Name|Value|
|----|----|-----|
|D1 database|DB|shurt_url|
## project
https://github.com/felix2027/sub-convert forked from [jwyGithub/sub-convert](https://github.com/jwyGithub/sub-convert)

## R76S 订阅模式

这个可选模式基于 `proxy_config_next.ini`，供运行 Mihomo 的 OpenClash 使用。它把当次转换得到的全部节点放入 YAML 内的同一个 `R76SNodes` 集合。每次更新订阅时重新生成集合和地区成员。路由器无需另取节点列表。

### 构建与使用

在仓库根目录用 Node.js 24 运行：

```sh
node --test workers/convert/tests/r76s.test.mjs
node workers/convert/r76s/build.mjs worker-r76s.mjs
```

第二条命令生成一个独立的 Worker 模块，只执行本地构建。构建器读取仓库内固定版本的 `workers/convert/worker.js`；更新该上游文件时，需要复查分批合并与名称还原的接口，并更新构建器中的摘要。

在提供该模块的 Worker 上，R76S 的专用订阅格式如下。`url` 传入 URL 编码后的源订阅。

```text
https://<自己的转换-Worker>/sub?target=clash&profile=r76s&url=<编码后的源订阅>
```

模式会指定本仓库 `main` 的 `config/proxy_config_next.ini`；也接受显式传入相同的 raw.githubusercontent.com 模板地址。使用 `target=clash` 和完整配置输出。直接指向其他转换服务的订阅仍由该服务生成；普通 Worker 请求继续走原有处理流程。

### 选线与探测

| 组 | R76S 模式行为 |
| --- | --- |
| `Auto`、`LoadBalance` | 使用全体节点的同一份健康状态和延迟；保留原有测速容差、负载均衡策略。 |
| `TW`、`SG`、`JP`、`US`、`HK` | 按 next 当次转换的实际成员筛选。订阅改名或增减节点后，下一次转换会重新生成精确匹配条件。 |
| `Fallback` | 在真实节点中依次选台湾、新加坡、日本、美国、香港、其他地区的第一个健康节点。同一地区内按集合顺序选择。手动出口仍可在 `Proxies → Manual` 中选择。 |
| `TW_HK_Fallback` | 与其他组共用探测结果，优先台湾、然后香港。此组不再单独探测 B 站或回退直连；需要直连时可在业务组中手选。 |

某个地区没有候选时，对应组只提供 `REJECT`，避免核心对空集合的默认回退。所有节点共用一个 `https://www.gstatic.com/generate_204` 健康检查，间隔 150 秒、超时 5 秒、期望 HTTP 204，空闲时也定时检查。它衡量出口连通性，站点解锁仍取决于实际出口。next 的业务选择组和分流规则沿用当次转换结果。
