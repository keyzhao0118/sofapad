using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using SofaPad.Core;

namespace SofaPad.Server;

public sealed class LocalServer(ControlState state) : IAsyncDisposable
{
    private WebApplication? app;
    public string? Url { get; private set; }
    public async Task StartAsync(string address, int port, string webRoot)
    {
        var files = Directory.GetFiles(webRoot).Where(f => Path.GetExtension(f) is ".html" or ".js" or ".css")
            .ToDictionary(f => "/" + Path.GetFileName(f), f => (Bytes: File.ReadAllBytes(f), Type: Path.GetExtension(f) switch
            { ".html" => "text/html; charset=utf-8", ".css" => "text/css; charset=utf-8", _ => "text/javascript; charset=utf-8" }), StringComparer.Ordinal);
        foreach (var required in new[] { "/index.html", "/app.js", "/style.css" })
            if (!files.ContainsKey(required)) throw new IOException("网页资源缺失：" + required);
        files["/"] = files["/index.html"];
        var authority = $"{address}:{port}";
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ContentRootPath = AppContext.BaseDirectory });
        builder.Logging.ClearProviders(); // Never log text, HTTP request bodies, or input events.
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false;
            options.Listen(IPAddress.Parse(address), port);
            options.Limits.MaxConcurrentConnections = 48;
            options.Limits.MaxConcurrentUpgradedConnections = 48;
            options.Limits.MaxRequestBodySize = Wire.MaxBytes;
            options.Limits.MaxRequestHeadersTotalSize = 8192;
            options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(5);
            options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(10);
        });
        var candidate = builder.Build();
        candidate.UseWebSockets(new WebSocketOptions { KeepAliveInterval = Timeout.InfiniteTimeSpan });
        candidate.Run(async context =>
        {
            var request = context.Request;
            var response = context.Response;
            response.Headers.CacheControl = "no-store";
            response.Headers.XContentTypeOptions = "nosniff";
            response.Headers.XFrameOptions = "DENY";
            response.Headers["Referrer-Policy"] = "no-referrer";
            response.Headers.ContentSecurityPolicy = $"default-src 'self'; connect-src 'self' ws://{authority}; img-src 'self' data:; media-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
            var origins = request.Headers.Origin;
            var isSocket = request.Path == "/ws";
            if (request.Headers.Host.Count != 1 || request.Host.Value != authority || origins.Count > 1 ||
                (origins.Count == 1 && origins[0] != "http://" + authority) ||
                ((isSocket || request.Method != "GET") && origins.Count != 1) || request.Headers["Sec-Fetch-Site"] == "cross-site")
            { response.StatusCode = 403; return; }
            if (request.ContentLength > Wire.MaxBytes) { response.StatusCode = 413; return; }
            if (request.Method != "GET")
            {
                // Consume only a bounded body (including chunked bodies) before returning 404.
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
                deadline.CancelAfter(TimeSpan.FromSeconds(3));
                try
                {
                    var buffer = new byte[4096]; var size = 0; int read;
                    while ((read = await request.Body.ReadAsync(buffer, deadline.Token)) > 0)
                        if ((size += read) > Wire.MaxBytes) { response.StatusCode = 413; return; }
                }
                catch (BadHttpRequestException) { response.StatusCode = 413; return; }
                catch (OperationCanceledException) { context.Abort(); return; }
                response.StatusCode = 404; return;
            }
            if (isSocket)
            {
                if (!context.WebSockets.IsWebSocketRequest) { response.StatusCode = 400; return; }
                using var socket = await context.WebSockets.AcceptWebSocketAsync();
                var agent = request.Headers.UserAgent.ToString();
                var label = agent.Contains("iPhone") ? "iPhone" : agent.Contains("iPad") ? "iPad" : agent.Contains("Android") ? "Android" : "浏览器";
                await new ControlConnection(socket, state, label + " · " + context.Connection.RemoteIpAddress).RunAsync(context.RequestAborted);
                return;
            }
            if (request.Path == "/api/status")
            {
                var snapshot = state.Snapshot();
                await response.WriteAsJsonAsync(new { name = state.Name, permitted = snapshot.Permitted,
                    controllers = snapshot.Controllers.Length, preview = state.Preview, v = 2, platform = "windows" }); return;
            }
            if (files.TryGetValue(request.Path.Value ?? "/", out var asset))
            { response.ContentType = asset.Type; response.ContentLength = asset.Bytes.Length; await response.Body.WriteAsync(asset.Bytes, context.RequestAborted); return; }
            response.StatusCode = 404;
        });
        try { await candidate.StartAsync(); app = candidate; Url = $"http://{authority}/"; }
        catch { await candidate.DisposeAsync(); throw; }
    }
    public async ValueTask DisposeAsync()
    {
        state.Disconnect(reason: "host_stopped");
        var current = app; app = null; Url = null;
        if (current is not null)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try { await current.StopAsync(timeout.Token); } catch (OperationCanceledException) { }
            await current.DisposeAsync();
        }
    }
}

internal sealed class ControlConnection(WebSocket socket, ControlState state, string label)
{
    private readonly Channel<object> outbound = Channel.CreateBounded<object>(new BoundedChannelOptions(32) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    private string? id;
    private long lastMessage = Stopwatch.GetTimestamp();
    private volatile bool ready;
    private int ending;
    private string reason = "client_disconnect";
    private bool lastPermission;
    private void Send(object value)
    {
        if (Volatile.Read(ref ending) == 0 && !outbound.Writer.TryWrite(value)) End("congested");
    }
    private void End(string why)
    {
        if (Interlocked.Exchange(ref ending, 1) != 0) return;
        reason = why;
        if (id is not null) state.Release(id);
        outbound.Writer.TryComplete();
    }
    public async Task RunAsync(CancellationToken abort)
    {
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(abort);
        Task writer = Task.CompletedTask, watcher = Task.CompletedTask;
        try
        {
            id = state.Acquire(label, value => { if (ready) Send(value); }, End);
            writer = WriteAsync(lifetime.Token);
            watcher = WatchAsync(lifetime.Token);
            var buffer = new byte[Wire.MaxBytes + 1];
            while (Volatile.Read(ref ending) == 0)
            {
                var length = 0; var reads = 0; ValueWebSocketReceiveResult result;
                // Bound the *complete* message. ReceiveAsync calls are not raw frames;
                // count them as receive operations, not as an RFC frame-rate promise.
                do
                {
                    result = await socket.ReceiveAsync(buffer.AsMemory(length), lifetime.Token);
                    if (result.MessageType == WebSocketMessageType.Close) { End("client_disconnect"); return; }
                    length += result.Count;
                    if (result.MessageType != WebSocketMessageType.Text || length > Wire.MaxBytes || ++reads > 64)
                        throw new ProtocolException();
                } while (!result.EndOfMessage);
                if (Volatile.Read(ref ending) != 0) break;
                if (!ready)
                {
                    using var document = Wire.Parse(buffer.AsMemory(0, length));
                    if (Wire.String(document.RootElement, "type") != "hello" || Wire.Integer(document.RootElement, "v") != 2)
                        throw new ProtocolException("version");
                    lastPermission = state.Snapshot().Permitted;
                    Send(state.Ready(id)); ready = true;
                }
                else if (state.Process(buffer.AsMemory(0, length), id).Type == "disconnect") End("client_disconnect");
                Interlocked.Exchange(ref lastMessage, Stopwatch.GetTimestamp());
            }
        }
        catch (ProtocolException e) { End(e.Message); }
        catch (Exception e) when (e is WebSocketException or System.Text.Json.JsonException or InvalidOperationException or
            System.Text.DecoderFallbackException or OperationCanceledException or IOException)
        { End("protocol"); }
        finally
        {
            End("client_disconnect");
            if (id is not null) state.Release(id);
            try { await writer; } catch (Exception e) when (e is WebSocketException or OperationCanceledException or IOException) { }
            await lifetime.CancelAsync();
            try { await watcher; } catch (OperationCanceledException) { }
        }
    }
    private async Task WatchAsync(CancellationToken token)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
        while (await timer.WaitForNextTickAsync(token) && Volatile.Read(ref ending) == 0)
        {
            if (Stopwatch.GetElapsedTime(Interlocked.Read(ref lastMessage)).TotalSeconds > (ready ? 6 : 3)) { End("timeout"); break; }
            var permitted = state.Snapshot().Permitted;
            if (ready && permitted != lastPermission) { lastPermission = permitted; Send(new { type = "status", permitted }); }
        }
    }
    private async Task WriteAsync(CancellationToken token)
    {
        try
        {
            await foreach (var value in outbound.Reader.ReadAllAsync(token))
            {
                if (Volatile.Read(ref ending) != 0) break;
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token); timeout.CancelAfter(2000);
                await socket.SendAsync(Wire.Encode(value), WebSocketMessageType.Text, true, timeout.Token);
            }
            using var closing = new CancellationTokenSource(1000);
            if (socket.State == WebSocketState.Open)
            {
                await socket.SendAsync(Wire.Encode(new { type = "disconnect", reason }), WebSocketMessageType.Text, true, closing.Token);
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, reason, closing.Token);
                // Give the peer a chance to consume the reason/close before aborting a
                // still-pending receive. An immediate abort can reset TCP on Windows.
                await Task.Delay(150, closing.Token);
            }
        }
        catch (Exception e) when (e is WebSocketException or OperationCanceledException or IOException) { End("congested"); }
        finally { socket.Abort(); }
    }
}
