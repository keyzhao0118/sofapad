using System.Collections.Concurrent;

namespace SofaPad.Windows;

internal sealed class ClipboardWorker : IDisposable
{
    private readonly BlockingCollection<(string Text, TaskCompletionSource<bool> Completion)> jobs = new(1);
    private readonly Thread thread;
    public ClipboardWorker()
    {
        thread = new Thread(() =>
        {
            foreach (var (text, completion) in jobs.GetConsumingEnumerable())
            {
                try { Clipboard.SetText(text, TextDataFormat.UnicodeText); completion.TrySetResult(true); }
                catch (Exception e) when (e is System.Runtime.InteropServices.ExternalException or ThreadStateException)
                { completion.TrySetResult(false); }
            }
        }) { IsBackground = true, Name = "SofaPad clipboard STA" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
    }
    public bool Write(string text)
    {
        var result = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        // Clipboard.SetText has a bounded built-in retry; wait for the actual result so
        // a timed-out job cannot overwrite the clipboard later.
        return jobs.TryAdd((text, result)) && result.Task.GetAwaiter().GetResult();
    }
    public void Dispose() { jobs.CompleteAdding(); thread.Join(2000); }
}
