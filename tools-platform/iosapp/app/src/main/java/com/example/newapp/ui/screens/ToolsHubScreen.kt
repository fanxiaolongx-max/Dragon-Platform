package com.example.newapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.shared.model.PlatformTool
import com.example.newapp.shared.model.ToolCategory
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.components.LiquidGlassSurface
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr

private enum class ToolFilterChip {
    ALL, NATIVE, DATA, ANALYTICS, WORKFLOW, CUSTOM;

    fun label(lang: String): String = when (this) {
        ALL -> tr(lang, "全部", "All")
        NATIVE -> tr(lang, "原生", "Native")
        DATA -> tr(lang, "数据", "Data")
        ANALYTICS -> tr(lang, "报表", "Analytics")
        WORKFLOW -> tr(lang, "流转", "Workflow")
        CUSTOM -> tr(lang, "扩展", "Custom")
    }

    fun matches(cat: ToolCategory): Boolean = when (this) {
        ALL -> true
        NATIVE -> cat == ToolCategory.NATIVE
        DATA -> cat == ToolCategory.DATA
        ANALYTICS -> cat == ToolCategory.ANALYTICS
        WORKFLOW -> cat == ToolCategory.WORKFLOW
        CUSTOM -> cat == ToolCategory.CUSTOM
    }
}

@Composable
fun ToolsHubScreen(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    var selectedFilter by remember { mutableStateOf(ToolFilterChip.ALL) }

    val gridTools = remember(vm.filteredTools, selectedFilter, vm.toolSearchQuery) {
        vm.filteredTools.filter {
            selectedFilter.matches(it.category) &&
                !(selectedFilter == ToolFilterChip.ALL && vm.toolSearchQuery.isBlank() && it.isNative)
        }
    }
    val pinnedTools = remember(vm.filteredTools, vm.favoriteToolIds) {
        vm.favoriteToolIds.mapNotNull { id -> vm.filteredTools.firstOrNull { it.id == id } }
    }
    val recentTools = remember(vm.filteredTools, vm.recentToolIds, vm.favoriteToolIds) {
        val favSet = vm.favoriteToolIds.toSet()
        vm.recentToolIds
            .filter { it !in favSet }
            .mapNotNull { id -> vm.filteredTools.firstOrNull { it.id == id } }
            .take(6)
    }

    LaunchedEffect(Unit) {
        vm.loadToolNavState()
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize().navigationBarsPadding()
    ) {
        item(span = { GridItemSpan(2) }) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = vm.toolSearchQuery,
                    onValueChange = { vm.toolSearchQuery = it },
                    placeholder = { Text(tr(lang, "搜索工具、报表或功能...", "Search tools & dashboards..."), fontSize = 12.5.sp) },
                    leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                    trailingIcon = {
                        if (vm.toolSearchQuery.isNotEmpty()) {
                            IconButton(onClick = { vm.toolSearchQuery = "" }) {
                                Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                            }
                        }
                    },
                    textStyle = LocalTextStyle.current.copy(fontSize = 13.sp),
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                ) {
                    ToolFilterChip.entries.forEach { chip ->
                        val isSelected = selectedFilter == chip
                        LiquidGlassSurface(
                            shape = CircleShape,
                            tint = if (isSelected) palette.accent else null,
                            tintAlpha = 0.20f,
                            elevation = if (isSelected) 5.dp else 3.dp,
                            onClick = { selectedFilter = chip }
                        ) {
                            Text(
                                text = chip.label(lang),
                                color = if (isSelected) palette.accentStrong else palette.inkSecondary,
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                            )
                        }
                    }
                }

                if (selectedFilter == ToolFilterChip.ALL && vm.toolSearchQuery.isBlank()) {
                    LiquidGlassSurface(
                        shape = RoundedCornerShape(20.dp),
                        tint = palette.accent,
                        tintAlpha = 0.12f,
                        elevation = 6.dp,
                        onClick = { vm.openMetricsModule() },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(14.dp)
                        ) {
                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier
                                    .size(44.dp)
                                    .background(palette.accent.copy(alpha = 0.18f), RoundedCornerShape(13.dp))
                            ) {
                                Icon(Icons.Rounded.ShowChart, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(22.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = tr(lang, "KPI 与 SLA 指标监控", "KPI & SLA Monitor"),
                                        color = palette.inkPrimary,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        text = tr(lang, "原生", "NATIVE"),
                                        color = palette.accentStrong,
                                        fontSize = 9.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier
                                            .background(palette.accent.copy(alpha = 0.16f), CircleShape)
                                            .padding(horizontal = 6.dp, vertical = 1.5.dp)
                                    )
                                }
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = tr(lang, "多月份指标快照、异常指标、临期工单与 30 天趋势分析", "Snapshots, failing KPIs, expiring tickets & 30-day trends"),
                                    color = palette.inkSecondary,
                                    fontSize = 11.sp,
                                    lineHeight = 15.sp,
                                    maxLines = 2
                                )
                            }
                            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }

        if (selectedFilter == ToolFilterChip.ALL && vm.toolSearchQuery.isBlank() && (pinnedTools.isNotEmpty() || recentTools.isNotEmpty())) {
            item(span = { GridItemSpan(2) }) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = tr(lang, "常用 & 最近", "Pinned & Recent"),
                        color = palette.inkMuted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(horizontal = 2.dp)
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                    ) {
                        pinnedTools.forEach { tool ->
                            ToolQuickNavPill(
                                tool = tool,
                                language = lang,
                                isFavorite = true,
                                onClick = { vm.openTool(tool) }
                            )
                        }
                        recentTools.forEach { tool ->
                            ToolQuickNavPill(
                                tool = tool,
                                language = lang,
                                isFavorite = false,
                                onClick = { vm.openTool(tool) }
                            )
                        }
                    }
                }
            }
        }

        items(gridTools, key = { it.id }) { tool ->
            ToolGridGlassCard(
                tool = tool,
                language = lang,
                isFavorite = vm.favoriteToolIds.contains(tool.id),
                onToggleFavorite = { vm.toggleFavoriteTool(tool.id) },
                onClick = { vm.openTool(tool) }
            )
        }
    }
}

@Composable
private fun ToolQuickNavPill(
    tool: PlatformTool,
    language: String,
    isFavorite: Boolean,
    onClick: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    LiquidGlassSurface(
        shape = CircleShape,
        tint = if (isFavorite) palette.warning else null,
        tintAlpha = 0.14f,
        elevation = 3.dp,
        onClick = onClick
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
        ) {
            Icon(
                imageVector = if (isFavorite) Icons.Rounded.Star else Icons.Rounded.History,
                contentDescription = null,
                tint = if (isFavorite) palette.warning else palette.inkMuted,
                modifier = Modifier.size(13.dp)
            )
            Text(
                text = tool.localizedTitle(language),
                color = palette.inkPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ToolGridGlassCard(
    tool: PlatformTool,
    language: String,
    isFavorite: Boolean,
    onToggleFavorite: () -> Unit,
    onClick: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    val accent = when (tool.category) {
        ToolCategory.NATIVE -> palette.accentStrong
        ToolCategory.DATA -> palette.info
        ToolCategory.ANALYTICS -> palette.accent
        ToolCategory.WORKFLOW -> palette.warning
        ToolCategory.CUSTOM -> Color(0xFF8B5CF6)
    }

    LiquidGlassSurface(
        shape = RoundedCornerShape(18.dp),
        elevation = 5.dp,
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().height(148.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(11.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(32.dp)
                        .background(accent.copy(alpha = 0.15f), RoundedCornerShape(10.dp))
                ) {
                    Icon(toolIconFor(tool.iconKey), contentDescription = null, tint = accent, modifier = Modifier.size(17.dp))
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Icon(
                        imageVector = if (tool.isNative) Icons.Rounded.AutoAwesome else Icons.Rounded.NorthEast,
                        contentDescription = null,
                        tint = palette.inkMuted,
                        modifier = Modifier.size(14.dp)
                    )
                    IconButton(
                        onClick = onToggleFavorite,
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = if (isFavorite) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                            contentDescription = if (isFavorite) tr(language, "取消收藏", "Unstar") else tr(language, "收藏", "Star"),
                            tint = if (isFavorite) palette.warning else palette.inkMuted,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }

            Column {
                Text(
                    text = tool.localizedTitle(language),
                    color = palette.inkPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = tool.localizedDesc(language),
                    color = palette.inkSecondary,
                    fontSize = 10.5.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = 14.5.sp
                )
            }

            Text(
                text = if (tool.isNative) tr(language, "原生视图", "Native") else tool.routePath,
                color = palette.inkMuted,
                fontSize = 9.5.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1
            )
        }
    }
}

private fun toolIconFor(key: String): ImageVector = when (key) {
    "kpi" -> Icons.Rounded.ShowChart
    "fetch" -> Icons.Rounded.Podcasts
    "import" -> Icons.Rounded.CloudDownload
    "report" -> Icons.Rounded.Analytics
    "expedite" -> Icons.Rounded.Bolt
    "monthly" -> Icons.Rounded.CalendarMonth
    "duty" -> Icons.Rounded.DarkMode
    "bigscreen" -> Icons.Rounded.Tv
    "topic" -> Icons.Rounded.TrackChanges
    "frt" -> Icons.Rounded.Timer
    "requirements" -> Icons.Rounded.Checklist
    "praudit" -> Icons.Rounded.VerifiedUser
    else -> Icons.Rounded.Build
}
