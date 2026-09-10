# 第三方依赖与致谢

Mac 使用 [Apple SwiftNIO](https://github.com/apple/swift-nio) 处理 HTTP／WebSocket，使用 [swift-nio-ssl](https://github.com/apple/swift-nio-ssl) 处理 TLS。完整版本和提交锁定于 Package.resolved。

| 依赖 | 锁定版本 | 许可 |
| --- | --- | --- |
| swift-nio | 2.102.0 | Apache-2.0，包含第三方组件见 NOTICE |
| swift-nio-ssl | 2.37.4 | Apache-2.0，包含 BoringSSL 等第三方组件 |
| BoringSSL（随 swift-nio-ssl） | 817ab07ebb53da35afea409ab9328f578492832d | OpenSSL／SSLeay／ISC，fiat 部分 MIT |
| swift-atomics | 1.3.1 | Apache-2.0 with Runtime Library Exception |
| swift-collections | 1.6.0 | Apache-2.0 with Runtime Library Exception |
| swift-system | 1.8.1 | Apache-2.0 with Runtime Library Exception |
| TypeScript（仅构建） | 5.9.3 | Apache-2.0 |

构建脚本将 Mac 依赖 LICENSE.txt 与适用 NOTICE.txt 复制到 App 的 Contents/Resources/Licenses/。SwiftNIO 的 llhttp MIT 和 CNIOSHA1 WIDE BSD 许可亦保留。TypeScript 编译器不随 App 分发，网页没有第三方运行时。

[BoringSSL 完整许可证](licenses/BoringSSL.txt) 来自锁定提交的 [上游文件](https://github.com/google/boringssl/blob/817ab07ebb53da35afea409ab9328f578492832d/LICENSE)，随 App 打包。依赖更新时核对 Sources/CNIOBoringSSL/hash.txt 并同步此文件。系统字体与 SF Symbols 由系统提供。

This product includes software developed by the OpenSSL Project for use in the OpenSSL Toolkit (http://www.openssl.org/).

This product includes cryptographic software written by Eric Young (eay@cryptsoft.com). This product includes software written by Tim Hudson (tjh@cryptsoft.com).
