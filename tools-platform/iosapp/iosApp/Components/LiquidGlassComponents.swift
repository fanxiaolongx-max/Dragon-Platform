import SwiftUI

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

/// Lightweight structured markdown + fenced code block renderer so AI replies render cleanly in native SwiftUI.
struct MarkdownMessageView: View {
    let text: String
    let palette: DragonClawPalette

    private enum Block: Identifiable {
        case text(id: Int, content: String)
        case code(id: Int, language: String, content: String)

        var id: Int {
            switch self {
            case .text(let id, _), .code(let id, _, _):
                return id
            }
        }
    }

    private var blocks: [Block] {
        var result: [Block] = []
        let lines = text.components(separatedBy: "\n")
        var currentText: [String] = []
        var currentCode: [String] = []
        var inCode = false
        var codeLang = ""
        var nextId = 0

        func flushText() {
            let joined = currentText.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty {
                result.append(.text(id: nextId, content: joined))
                nextId += 1
            }
            currentText.removeAll()
        }

        func flushCode() {
            let joined = currentCode.joined(separator: "\n")
            result.append(.code(id: nextId, language: codeLang, content: joined))
            nextId += 1
            currentCode.removeAll()
            codeLang = ""
        }

        for line in lines {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                if inCode {
                    flushCode()
                    inCode = false
                } else {
                    flushText()
                    codeLang = String(line.trimmingCharacters(in: .whitespaces).dropFirst(3)).trimmingCharacters(in: .whitespaces)
                    inCode = true
                }
            } else if inCode {
                currentCode.append(line)
            } else {
                currentText.append(line)
            }
        }
        if inCode {
            flushCode()
        } else {
            flushText()
        }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if blocks.isEmpty && !text.isEmpty {
                inlineText(text)
            } else {
                ForEach(blocks) { block in
                    switch block {
                    case .text(_, let content):
                        inlineText(content)
                    case .code(_, let language, let code):
                        VStack(alignment: .leading, spacing: 0) {
                            HStack {
                                Text(language.isEmpty ? "code" : language.uppercased())
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

                            Text(code)
                                .font(.system(size: 10.5, design: .monospaced))
                                .lineSpacing(1.5)
                                .foregroundStyle(palette.inkPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                                .padding(10)
                        }
                        .background(palette.elevatedSurface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(palette.hairLine, lineWidth: 0.75)
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func inlineText(_ raw: String) -> some View {
        let attributed = (try? AttributedString(
            markdown: raw,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        )) ?? AttributedString(raw)

        Text(attributed)
            .font(.system(size: 12.5, weight: .regular))
            .lineSpacing(2)
            .foregroundStyle(palette.inkPrimary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }
}
