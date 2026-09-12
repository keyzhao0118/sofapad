# 第三方依赖与致谢

Mac 使用 [Apple SwiftNIO](https://github.com/apple/swift-nio) 处理 HTTP／WebSocket。完整版本和提交锁定于 Package.resolved。

| 依赖 | 锁定版本 | 许可 |
| --- | --- | --- |
| swift-nio | 2.102.0 | Apache-2.0，包含第三方组件见 NOTICE |
| swift-atomics | 1.3.1 | Apache-2.0 with Runtime Library Exception |
| swift-collections | 1.6.0 | Apache-2.0 with Runtime Library Exception |
| swift-system | 1.8.1 | Apache-2.0 with Runtime Library Exception |
| TypeScript（仅构建） | 5.9.3 | Apache-2.0 |

构建脚本把 Mac 依赖的 LICENSE.txt 与适用 NOTICE.txt 复制到 App 的 Contents/Resources/Licenses/，并保留 SwiftNIO 的 llhttp MIT 与 CNIOSHA1 WIDE BSD 许可。TypeScript 编译器不随 App 分发，网页没有第三方运行时。

系统字体与 SF Symbols 由系统提供。
