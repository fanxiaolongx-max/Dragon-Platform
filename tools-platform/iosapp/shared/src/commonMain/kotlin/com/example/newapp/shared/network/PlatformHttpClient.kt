package com.example.newapp.shared.network

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig

expect fun createPlatformHttpClient(block: HttpClientConfig<*>.() -> Unit): HttpClient
