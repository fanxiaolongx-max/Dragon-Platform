import SwiftUI
import UIKit
import shared

/// Ambient soft backdrop matching Dragon Claw Homepage v2 while letting iOS 26 Liquid Glass refract real color.
struct DragonClawBackdrop: View {
    let palette: DragonClawPalette

    var body: some View {
        ZStack {
            palette.background.ignoresSafeArea()

            Circle()
                .fill(
                    RadialGradient(
                        colors: [palette.ambientGlowPrimary, .clear],
                        center: .center,
                        startRadius: 10,
                        endRadius: 260
                    )
                )
                .frame(width: 440, height: 440)
                .offset(x: 130, y: -220)
                .allowsHitTesting(false)

            Circle()
                .fill(
                    RadialGradient(
                        colors: [palette.ambientGlowSecondary, .clear],
                        center: .center,
                        startRadius: 10,
                        endRadius: 240
                    )
                )
                .frame(width: 380, height: 380)
                .offset(x: -140, y: 260)
                .allowsHitTesting(false)
        }
        .ignoresSafeArea()
    }
}

/// Top or floating circular Liquid Glass icon button.
struct GlassCircleIconButton: View {
    let systemImage: String
    var tint: Color? = nil
    var accessibilityLabel: String = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(tint ?? .primary)
                .frame(width: 34, height: 34)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel(accessibilityLabel)
    }
}

/// Native iOS 26 Liquid Glass segmented switcher with synchronized morphing pill indicator (`Chat` / `Tools`).
struct GlassModeSegmentedPill<Option: Hashable>: View {
    let options: [(Option, String, String)]
    @Binding var selection: Option
    let palette: DragonClawPalette
    @Namespace private var glassNamespace

    var body: some View {
        GlassEffectContainer(spacing: 6) {
            HStack(spacing: 4) {
                ForEach(options, id: \.0) { option, title, icon in
                    let isSelected = selection == option
                    Button {
                        withAnimation(.snappy(duration: 0.28, extraBounce: 0.08)) {
                            selection = option
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: icon)
                                .font(.system(size: 11.5, weight: .semibold))
                            Text(title)
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(isSelected ? palette.accentStrong : palette.inkSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6.5)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .background {
                        if isSelected {
                            Capsule()
                                .fill(palette.accent.opacity(palette.isDark ? 0.22 : 0.14))
                                .glassEffectID("modeSelection", in: glassNamespace)
                        }
                    }
                }
            }
            .padding(4)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
    }
}

/// Structured block + inline Markdown renderer powered by shared `MarkdownParser`.
struct MarkdownMessageView: View {
    let text: String
    let palette: DragonClawPalette

    private var blocks: [MdBlock] {
        MarkdownParser.shared.parse(raw: text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if blocks.isEmpty && !text.isEmpty {
                Text(text)
                    .font(.system(size: 14.5))
                    .lineSpacing(4.5)
                    .foregroundStyle(palette.inkPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                    blockView(block, isFirst: index == 0)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func blockView(_ block: MdBlock, isFirst: Bool) -> some View {
        switch block.kind {
        case .heading:
            let size: CGFloat = switch block.level {
            case 1: 18
            case 2: 16.5
            case 3: 15.5
            default: 14.5
            }
            Text(attributedSpans(block.spans, baseSize: size, forceBold: true))
                .lineSpacing(3.5)
                .foregroundStyle(palette.inkPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, isFirst ? 0 : 6)

        case .paragraph:
            Text(attributedSpans(block.spans, baseSize: 14.5))
                .lineSpacing(4.5)
                .foregroundStyle(palette.inkPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

        case .bulletItem:
            let level = Int(block.level)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(level == 0 ? "•" : (level == 1 ? "◦" : "▪"))
                    .font(.system(size: 14.5, weight: .bold))
                    .foregroundStyle(level == 0 ? palette.inkPrimary : palette.inkSecondary)
                    .frame(width: 12, alignment: .center)

                Text(attributedSpans(block.spans, baseSize: 14.5))
                    .lineSpacing(4.5)
                    .foregroundStyle(palette.inkPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, CGFloat(level * 15))

        case .orderedItem:
            let level = Int(block.level)
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(block.marker)
                    .font(.system(size: 14.5, weight: .semibold).monospacedDigit())
                    .foregroundStyle(palette.inkPrimary)
                    .frame(minWidth: 20, alignment: .trailing)

                Text(attributedSpans(block.spans, baseSize: 14.5))
                    .lineSpacing(4.5)
                    .foregroundStyle(palette.inkPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, CGFloat(level * 15))

        case .blockquote:
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(palette.accentStrong.opacity(0.8))
                    .frame(width: 3)

                Text(attributedSpans(block.spans, baseSize: 14))
                    .lineSpacing(4)
                    .foregroundStyle(palette.inkSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(palette.elevatedSurface.opacity(0.65), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

        case .divider:
            Rectangle()
                .fill(palette.hairLine)
                .frame(height: 1)
                .padding(.vertical, 4)

        case .codeBlock:
            codeBlockView(language: block.codeLanguage, code: block.codeText)

        case .table:
            tableBlockView(rows: block.tableRows)

        default:
            Text(attributedSpans(block.spans, baseSize: 14.5))
                .lineSpacing(4.5)
                .foregroundStyle(palette.inkPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func codeBlockView(language: String, code: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "CODE" : language.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(palette.inkMuted)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption2)
                        .foregroundStyle(palette.inkSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(palette.hairLine)

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: 12.5, design: .monospaced))
                    .lineSpacing(2.5)
                    .foregroundStyle(palette.inkPrimary)
                    .textSelection(.enabled)
                    .padding(11)
            }
        }
        .background(palette.elevatedSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(palette.hairLine, lineWidth: 0.75)
        )
    }

    @ViewBuilder
    private func tableBlockView(rows: [[[MdSpan]]]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(Array(row.enumerated()), id: \.offset) { colIdx, cell in
                            Text(attributedSpans(cell, baseSize: 13, forceBold: rowIdx == 0))
                                .foregroundStyle(palette.inkPrimary)
                                .frame(minWidth: 88, maxWidth: 220, alignment: .leading)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                            if colIdx < row.count - 1 {
                                Rectangle()
                                    .fill(palette.hairLine)
                                    .frame(width: 0.75)
                            }
                        }
                    }
                    .background(rowIdx == 0 ? palette.hairLine.opacity(0.65) : .clear)
                    if rowIdx < rows.count - 1 {
                        Rectangle()
                            .fill(palette.hairLine)
                            .frame(height: 0.75)
                    }
                }
            }
            .background(palette.elevatedSurface.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(palette.hairLine, lineWidth: 0.75)
            )
        }
    }

    private func attributedSpans(
        _ spans: [MdSpan],
        baseSize: CGFloat,
        forceBold: Bool = false
    ) -> AttributedString {
        var result = AttributedString()
        let codeBg = palette.isDark
            ? Color(white: 0.22)
            : Color(red: 0.91, green: 0.94, blue: 0.97)
        let chipBg = palette.isDark
            ? Color(red: 0.14, green: 0.20, blue: 0.30)
            : Color(red: 0.90, green: 0.94, blue: 0.99)
        let chipFg = palette.isDark
            ? Color(red: 0.62, green: 0.80, blue: 1.0)
            : Color(red: 0.10, green: 0.36, blue: 0.70)
        let codeFg = palette.isDark
            ? Color(red: 0.90, green: 0.93, blue: 0.98)
            : Color(red: 0.14, green: 0.20, blue: 0.28)

        for span in spans {
            let bold = forceBold || span.isBold || span.kind == .bold
            switch span.kind {
            case .code:
                var piece = AttributedString("\u{202F}\(span.text)\u{202F}")
                piece.font = .system(size: max(12, baseSize - 1.2), weight: .medium, design: .monospaced)
                piece.foregroundColor = codeFg
                piece.backgroundColor = codeBg
                result += piece

            case .symbolChip:
                if let badge = span.badge, !badge.isEmpty {
                    var tag = AttributedString("\u{202F}\(badge) ")
                    tag.font = .system(size: max(10, baseSize - 3.5), weight: .bold, design: .monospaced)
                    tag.foregroundColor = badgeColor(badge)
                    tag.backgroundColor = chipBg
                    result += tag
                } else {
                    var pad = AttributedString("\u{202F}")
                    pad.backgroundColor = chipBg
                    result += pad
                }
                var label = AttributedString("\(span.text)\u{202F}")
                label.font = .system(size: max(12, baseSize - 1.2), weight: .semibold, design: .monospaced)
                label.foregroundColor = chipFg
                label.backgroundColor = chipBg
                result += label

            case .webLink:
                var piece = AttributedString(span.text)
                piece.font = .system(size: baseSize, weight: bold ? .semibold : .medium)
                piece.foregroundColor = palette.accentStrong
                piece.underlineStyle = .single
                if let urlStr = span.url, let url = URL(string: urlStr) {
                    piece.link = url
                }
                result += piece

            case .plain, .bold, .italic:
                var piece = AttributedString(span.text)
                var font = Font.system(size: baseSize, weight: bold ? .semibold : .regular)
                if span.isItalic || span.kind == .italic {
                    font = font.italic()
                }
                piece.font = font
                piece.foregroundColor = palette.inkPrimary
                result += piece

            default:
                var piece = AttributedString(span.text)
                piece.font = .system(size: baseSize, weight: bold ? .semibold : .regular)
                piece.foregroundColor = palette.inkPrimary
                result += piece
            }
        }
        return result
    }

    private func badgeColor(_ badge: String) -> Color {
        switch badge {
        case "PY": return Color(red: 0.22, green: 0.72, blue: 0.45)
        case "JS", "TS": return Color(red: 0.85, green: 0.62, blue: 0.14)
        case "KT", "SW": return Color(red: 0.90, green: 0.42, blue: 0.24)
        default: return palette.accentStrong
        }
    }
}
