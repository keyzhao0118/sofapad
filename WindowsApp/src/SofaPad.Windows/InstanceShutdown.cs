namespace SofaPad.Windows;

internal static class InstanceShutdown
{
    // The installer must wait for the tray's input cleanup and server shutdown,
    // rather than deleting files after an arbitrary delay.
    internal static bool Request(EventWaitHandle signal, string mutexName, TimeSpan timeout)
    {
        if (!Mutex.TryOpenExisting(mutexName, out var instance)) return true;
        using (instance)
        {
            signal.Set();
            var acquired = false;
            try
            {
                try { acquired = instance.WaitOne(timeout); }
                catch (AbandonedMutexException) { acquired = true; }
                return acquired;
            }
            finally { if (acquired) instance.ReleaseMutex(); }
        }
    }
}
