package com.example.newapp.shared.util

import io.ktor.http.URLBuilder
import io.ktor.http.Url
import io.ktor.http.encodedPath

/** Mirrors the web new-tab entry point; never rewrites third-party tools. */
object ToolNavigation {
    fun buildUrl(baseUrl: String, routePath: String): String {
        val clean = routePath.trim()
        val absolute = if (clean.startsWith("http://") || clean.startsWith("https://")) clean
            else baseUrl.trimEnd('/') + "/" + clean.trimStart('/')
        val base = Url(baseUrl)
        val target = Url(absolute)
        if (!target.host.equals(base.host, true) || target.port != base.port || target.protocol != base.protocol) return absolute
        val builder = URLBuilder(target)
        val custom = Regex("^/tools/([^/]+)/?$").matchEntire(target.encodedPath)
        if (custom != null) builder.encodedPath = "/custom-tools/${custom.groupValues[1]}/index.html"
        builder.parameters["standalone"] = "1"
        builder.parameters["tools_mobile"] = "1"
        return builder.buildString()
    }
}
