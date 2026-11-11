import SwiftUI

@main
struct iOSApp: App {
    @State private var store = DragonClawStore()

    var body: some Scene {
        WindowGroup {
            ContentView(store: store)
                .preferredColorScheme(store.colorScheme)
        }
    }
}
