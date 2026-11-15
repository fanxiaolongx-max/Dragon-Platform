import SwiftUI

@main
struct iOSApp: App {
    @State private var store = DragonClawStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(store: store)
                .preferredColorScheme(store.colorScheme)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        store.appDidBecomeActive()
                    } else if phase == .background {
                        store.appDidEnterBackground()
                    }
                }
        }
    }
}
