package com.example.newapp.shared

import com.example.newapp.shared.util.ToolNavigation
import kotlin.test.Test
import kotlin.test.assertEquals

class ToolNavigationTest {
    private val base = "https://tools.example.com"
    @Test fun opensCustomDocumentWithoutPlatformWrapper() {
        assertEquals("$base/custom-tools/eos_tool-v8/index.html?standalone=1", ToolNavigation.buildUrl(base, "/tools/eos_tool-v8"))
    }
    @Test fun keepsParametersAndFragment() {
        assertEquals("$base/report?month=11&standalone=1#chart", ToolNavigation.buildUrl(base, "/report?month=11&standalone=0#chart"))
    }
    @Test fun leavesOtherOriginsAlone() {
        for (url in listOf("https://other.example.com/tools/test", "http://tools.example.com/tools/test", "$base:8443/tools/test")) {
            assertEquals(url, ToolNavigation.buildUrl(base, url))
        }
    }
}
