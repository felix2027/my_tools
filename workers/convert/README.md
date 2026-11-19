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

某个地区没有候选时，对应组只提供 `REJECT`，避免核心对空集合的默认回退。所有节点共用一个 `https://www.gstatic.com/generate_204` 健康检查，默认间隔 150 秒、超时 5 秒、期望 HTTP 204，空闲时也定时检查。它衡量出口连通性，站点解锁仍取决于实际出口。next 的业务选择组和分流规则沿用当次转换结果。

### 双 WAN 和按月计费的 F50

若 WAN1（RJ45）用于获准直连的国内服务、WAN2（USB F50）用于代理，可在**专用 Worker** 设置文本变量 `R76S_PROXY_ROUTING_MARK`。值取路由器为 WAN2 代理流量分配的独立防火墙标记，支持十进制或 `0x` 十六进制。先与 OpenWrt 的路由规则、掩码及 OpenClash 的标记核对。原双 WAN 教程的 `0x162` 用于把 LAN 流量送进 TUN，转换器会拒绝这个值。

配置变量后，每次 R76S 订阅更新都会把该标记写入 `R76SNodes.override.routing-mark`。连代理节点的套接字和经节点发起的探测都带它，即使节点地址落在国内网段。内置 `DIRECT` 和业务选择组沿用各自的路由。转换器还会在 next 的规则之前为三个真实 IPv4 私网目的网段（10/8、172.16/12、192.168/16）加上 `DIRECT,no-resolve`。已知目的 IP 直接交系统查路由，内网域名由网关的分区 DNS 处理。省略变量可继续使用由系统默认出口承载代理的基线模式。[Mihomo 集合覆写](https://wiki.metacubex.one/config/proxy-providers/#override)

| 流量 | 路由器端需要落实的策略 |
| --- | --- |
| 节点拨号及健康检查 | 将该标记送入 WAN2 专用路由表，优先于按目的地判定的国内公网分流。给该表配置不可达兜底，并在 WAN1 实际出口阻断带此标记的流量。USB 拔出、蜂窝断网或额度用尽时，代理请求应失败。 |
| 获准的国内直连 | 用路由器的持久规则维护明确的业务白名单，引到 WAN1；WAN1 中断时这些业务是否允许消耗 F50 流量应显式决定。`Direct` 策略组、手选 `DIRECT` 和国内 IP 本身都不代表某个业务已获准。共享 CDN 上按域名授权的服务要在能识别域名的位置分类。 |
| 内网与 DNS | 保留本地 LAN/VLAN 的更具体路由。远端 10/8、172.16/12 走 WAN1，远端 192.168/16 按规划走 WAN2。代理端点域名的引导解析需在冷启动时能得到真实地址；解析流量另由路由器选路。 |

用 Worker 文本变量 `R76S_PROBE_INTERVAL_SECONDS` 可以为全部节点一起调整探测周期。以 138 个节点全天运行为例，默认 150 秒一轮约 79,488 次定时探测，改为 600 秒约 19,872 次。长周期节省流量，也会延后发现故障和恢复的时间。实际字节数取决于协议、握手和重试。

月额度由路由器按 F50 的实际上下行字节累计，包含后台探测。计数需跨 USB 重连和重启保留。达到套餐限额时在 WAN2 出口阻断或停用相应流量，国内白名单仍可使用 WAN1。额度、结算日和已用量由套餐决定。下游设备自带的 VPN 或代理也需要在网关单独管控。

上机时核对 OpenClash 合并后的配置及两口计数器，分别测试节点掉线、USB 拔出、USB 在线但蜂窝断网、模拟额度用尽和恢复。基线按 IPv4 验收；启用 IPv6 前应给 IPv6 同样的出口限制。通过 WAN1 的获准业务应能在 WAN2 中断时继续使用。
