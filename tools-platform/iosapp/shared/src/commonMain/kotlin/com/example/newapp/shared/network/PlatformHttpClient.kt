package com.example.newapp.shared.network

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig

expect fun createPlatformHttpClient(block: HttpClientConfig<*>.() -> Unit): HttpClient

expect suspend fun streamNdjsonPost(
    client: HttpClient,
    url: String,
    bearerHeader: String,
    jsonBody: String,
    onLine: suspend (String) -> Unit
)
