import SwiftUI

struct ContentView: View {
    @Bindable var store: DragonClawStore

    var body: some View {
        Group {
            if store.isAuthenticated {
                RootShellView(store: store)
                    .transition(.opacity)
            } else {
                LoginView(store: store)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.24), value: store.isAuthenticated)
    }
}
