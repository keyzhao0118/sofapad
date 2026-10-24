using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace SofaPad.Windows;

internal sealed record NetworkAddress(string Adapter, string Address, int Priority)
{
    public string Label => $"{Adapter} · {Address}";
    internal static bool IsPrivate(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return b.Length == 4 && (b[0] == 10 || (b[0] == 172 && b[1] is >= 16 and <= 31) || (b[0] == 192 && b[1] == 168));
    }
    internal static NetworkAddress[] Find()
    {
        return NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType is NetworkInterfaceType.Wireless80211 or NetworkInterfaceType.Ethernet)
            .SelectMany(n =>
            {
                var properties = n.GetIPProperties();
                var virtualAdapter = new[] { "virtual", "vpn", "hyper-v", "vmware", "vethernet", "tailscale", "zerotier", "tap-", "wintun" }
                    .Any(word => (n.Name + " " + n.Description).Contains(word, StringComparison.OrdinalIgnoreCase));
                var priority = (virtualAdapter ? 100 : 0) + (properties.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork) ? 0 : 10);
                return properties.UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && IsPrivate(a.Address))
                    .Select(a => new NetworkAddress(n.Name, a.Address.ToString(), priority));
            }).OrderBy(n => n.Priority).ThenBy(n => n.Adapter).ToArray();
    }
}
