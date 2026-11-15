package com.example.newapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.activity.viewModels
import com.example.newapp.shared.AppContext
import com.example.newapp.shared.network.DragonClawNetworkConfig
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.screens.LoginScreen
import com.example.newapp.ui.screens.RootShellScreen
import com.example.newapp.ui.theme.DragonClawTheme

class MainActivity : ComponentActivity() {
    private val vm: DragonClawViewModel by viewModels()

    override fun onStart() {
        super.onStart()
        vm.onAppForeground()
    }

    override fun onStop() {
        vm.onAppBackground()
        super.onStop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        AppContext.context = applicationContext
        DragonClawNetworkConfig.verboseLogging = BuildConfig.DEBUG
        setContent {
            val view = LocalView.current
            LaunchedEffect(vm.isDark) {
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = !vm.isDark
                controller.isAppearanceLightNavigationBars = !vm.isDark
            }
            DragonClawTheme(isDark = vm.isDark) {
                AnimatedContent(
                    targetState = vm.isAuthenticated,
                    transitionSpec = {
                        // Signing in settles the workspace forward; signing out lets it recede.
                        val enterScale = if (targetState) 0.96f else 1.04f
                        val exitScale = if (targetState) 1.04f else 0.96f
                        (fadeIn(tween(320)) + scaleIn(tween(320), initialScale = enterScale)) togetherWith
                            (fadeOut(tween(200)) + scaleOut(tween(200), targetScale = exitScale))
                    },
                    label = "rootAuth"
                ) { authenticated ->
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
