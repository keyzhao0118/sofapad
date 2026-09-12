import Foundation

/// When the service may start itself.
///
/// The service should be on whenever the app is: at launch, and again as soon as a
/// usable address appears — logging in at startup often beats the network, so the
/// first attempt can legitimately fail. An explicit "stop service" is respected until
/// the user starts it again, and a scheduled restart always wins over the wait.
public enum ServiceLaunchPolicy {
    public static func shouldStart(running: Bool, changing: Bool, stoppedByUser: Bool,
                                   hasAddress: Bool, addressAppeared: Bool, restartPending: Bool) -> Bool {
        guard !running, !changing, !stoppedByUser, hasAddress else { return false }
        return addressAppeared || restartPending
    }
}
