package com.example.newapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.newapp.shared.AppContext
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.screens.LoginScreen
import com.example.newapp.ui.screens.RootShellScreen
import com.example.newapp.ui.theme.DragonClawTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        AppContext.context = applicationContext
        setContent {
            val vm: DragonClawViewModel = viewModel()
            val view = LocalView.current
            LaunchedEffect(vm.isDark) {
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = !vm.isDark
                controller.isAppearanceLightNavigationBars = !vm.isDark
            }
            DragonClawTheme(isDark = vm.isDark) {
                Crossfade(targetState = vm.isAuthenticated, label = "rootAuth") { authenticated ->
                    if (authenticated) {
                        RootShellScreen(vm)
                    } else {
                        LoginScreen(vm)
                    }
                }
            }
        }
    }
}
