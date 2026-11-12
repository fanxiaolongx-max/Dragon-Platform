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
    var token: String = ""
    var baseUrl: String = ""
    var onTapImage: ((String, String) -> Void)? = nil

    private var blocks: [MdBlock] {
        MarkdownParser.shared.parse(raw: text)
    }

    private var runs: [MarkdownRenderRun] {
        DragonClawHelpers.shared.buildMarkdownRenderRuns(blocks: blocks)
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
                ForEach(Array(runs.enumerated()), id: \.offset) { index, run in
                    if run.imageGroup.count >= 2 {
                        let deckItems: [LightboxImageItem] = run.imageGroup.compactMap { imgBlock in
                            let resolved = DragonClawHelpers.shared.resolveImageSourceUrl(baseUrl: baseUrl, rawSrc: imgBlock.imageUrl)
                            let finalUrl = resolved.isEmpty ? imgBlock.imageUrl : resolved
                            guard !finalUrl.isEmpty else { return nil }
                            let title = imgBlock.imageAlt.isEmpty
                                ? DragonClawHelpers.shared.basename(pathOrUrl: imgBlock.imageUrl)
                                : imgBlock.imageAlt
                            return LightboxImageItem(urlString: finalUrl, title: title)
                        }
                        if !deckItems.isEmpty {
                            ChatStackedImageDeckView(
                                items: deckItems,
                                token: token,
                                palette: palette,
                                onOpenLightbox: { items, tappedIdx in
                                    guard items.indices.contains(tappedIdx) else { return }
                                    let chosen = items[tappedIdx]
                                    onTapImage?(chosen.urlString, chosen.title)
                                }
                            )
                            .padding(.vertical, 2)
                        }
                    } else if let block = run.block {
                        blockView(block, isFirst: index == 0)
                    }
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

        case .image:
            let resolved = DragonClawHelpers.shared.resolveImageSourceUrl(baseUrl: baseUrl, rawSrc: block.imageUrl)
            let finalUrl = resolved.isEmpty ? block.imageUrl : resolved
            if !finalUrl.isEmpty {
                AuthenticatedRemoteImageView(
                    urlString: finalUrl,
                    token: token,
                    alt: block.imageAlt,
                    adaptiveMaxWidth: 232,
                    cornerRadius: 14,
                    palette: palette
                ) { _ in
                    onTapImage?(finalUrl, block.imageAlt)
                }
                .padding(.vertical, 2)
            }

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
        let columnCount = rows.map { $0.count }.max() ?? 0
        let columnWidths: [CGFloat] = (0..<columnCount).map { column in
            let longest = rows.map { row in
                row.indices.contains(column) ? row[column].map { $0.text.count }.reduce(0, +) : 0
            }.max() ?? 0
            return min(220, max(100, CGFloat(longest) * 10 + 20))
        }
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(Array(row.enumerated()), id: \.offset) { colIdx, cell in
                            Text(attributedSpans(cell, baseSize: 13, forceBold: rowIdx == 0))
                                .foregroundStyle(palette.inkPrimary)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .frame(width: columnWidths[colIdx], alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                    }
                    .background(rowIdx == 0 ? palette.hairLine.opacity(0.65)
                                : (rowIdx.isMultiple(of: 2) ? palette.hairLine.opacity(0.2) : .clear))
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

struct LightboxImageItem: Identifiable, Hashable {
    let id = UUID()
    let urlString: String
    let title: String
}

struct LightboxPayload: Identifiable {
    let id = UUID()
    let items: [LightboxImageItem]
    let initialIndex: Int
    let token: String
}

final class AuthenticatedImageCache: @unchecked Sendable {
    static let shared = AuthenticatedImageCache()
    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.countLimit = 120
        cache.totalCostLimit = 80 * 1024 * 1024
    }

    func cached(for key: String) -> UIImage? {
        cache.object(forKey: key as NSString)
    }

    func cachedImage(urlString: String, token: String) -> UIImage? {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return cached(for: "\(trimmed)#\(token.prefix(12))")
    }

    func store(_ image: UIImage, for key: String) {
        let bytes = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: max(1, bytes))
    }

    func load(urlString: String, token: String) async -> UIImage? {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let cacheKey = "\(trimmed)#\(token.prefix(12))"
        if let hit = cached(for: cacheKey) {
            return hit
        }

        if trimmed.lowercased().hasPrefix("data:image/"),
           let commaIdx = trimmed.firstIndex(of: ",") {
            let b64 = String(trimmed[trimmed.index(after: commaIdx)...])
            if let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
               let img = UIImage(data: data) {
                store(img, for: cacheKey)
                return img
            }
            return nil
        }

        guard let url = URL(string: trimmed) else { return nil }
        var req = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 25)
        if !token.isEmpty {
            req.setValue(DragonClawHelpers.shared.normalizeBearerHeader(rawToken: token), forHTTPHeaderField: "Authorization")
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                return nil
            }
            if let img = UIImage(data: data) {
                store(img, for: cacheKey)
                return img
            }
        } catch {
            return nil
        }
        return nil
    }
}

struct AuthenticatedRemoteImageView: View {
    let urlString: String
    let token: String
    var alt: String = ""
    var fixedSize: CGSize? = nil
    var adaptiveMaxWidth: CGFloat? = 246
    var cornerRadius: CGFloat = 16
    var innerPadding: CGFloat = 0
    let palette: DragonClawPalette
    var onTap: ((UIImage?) -> Void)? = nil

    @State private var loadedImage: UIImage?
    @State private var failed = false

    private var activeImage: UIImage? {
        loadedImage ?? AuthenticatedImageCache.shared.cachedImage(urlString: urlString, token: token)
    }

    private var resolvedFrame: (size: CGSize, padding: CGFloat, needsBackdrop: Bool) {
        if let fixed = fixedSize {
            return (fixed, innerPadding, false)
        }
        let img = activeImage
        let pxW = Int32((img?.size.width ?? 0) * (img?.scale ?? 1))
        let pxH = Int32((img?.size.height ?? 0) * (img?.scale ?? 1))
        let maxW = Double(adaptiveMaxWidth ?? 246)
        let frame = DragonClawHelpers.shared.computeAestheticSingleImageFrame(
            pixelWidth: pxW,
            pixelHeight: pxH,
            maxContainerWidth: maxW
        )
        return (
            CGSize(width: CGFloat(frame.width), height: CGFloat(frame.height)),
            max(innerPadding, CGFloat(frame.innerPadding)),
            frame.needsBackdropFrame
        )
    }

    @ViewBuilder
    private var cardSurface: some View {
        let layout = resolvedFrame
        let backdropFill = layout.needsBackdrop
            ? palette.cardSurface.opacity(palette.isDark ? 0.90 : 0.96)
            : palette.elevatedSurface.opacity(0.68)

        ZStack {
            if let uiImage = activeImage {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .padding(layout.padding)
                    .frame(width: layout.size.width, height: layout.size.height)
            } else if failed {
                VStack(spacing: 6) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.subheadline)
                        .foregroundStyle(palette.inkMuted)
                    if !alt.isEmpty {
                        Text(alt)
                            .font(.caption2)
                            .foregroundStyle(palette.inkSecondary)
                            .lineLimit(1)
                    }
                }
                .padding(10)
                .frame(width: layout.size.width, height: layout.size.height)
            } else {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: layout.size.width, height: layout.size.height)
            }
        }
        .frame(width: layout.size.width, height: layout.size.height)
        .background(backdropFill)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .stroke(palette.hairLine, lineWidth: 0.75)
        )
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    var body: some View {
        Group {
            if let onTap {
                Button {
                    onTap(activeImage)
                } label: {
                    cardSurface
                }
                .buttonStyle(.plain)
            } else {
                cardSurface
            }
        }
        .task(id: "\(urlString)_\(token.prefix(12))") {
            failed = false
            if let hit = AuthenticatedImageCache.shared.cachedImage(urlString: urlString, token: token) {
                loadedImage = hit
                return
            }
            if let img = await AuthenticatedImageCache.shared.load(urlString: urlString, token: token) {
                loadedImage = img
            } else {
                failed = true
            }
        }
    }
}

enum ChatDeckGestureTags {
    static let horizontalDeckViewTag = 948271
}

private struct InteractiveDeckGestureOverlay: UIViewRepresentable {
    let onTap: () -> Void
    let onDragChanged: (CGFloat) -> Void
    let onDragEnded: (CGFloat, CGFloat) -> Void
    let onDragCancelled: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = true
        view.tag = ChatDeckGestureTags.horizontalDeckViewTag

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delegate = context.coordinator

        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delaysTouchesBegan = false
        pan.cancelsTouchesInView = true
        pan.delegate = context.coordinator

        view.addGestureRecognizer(tap)
        view.addGestureRecognizer(pan)
        context.coordinator.panRecognizer = pan
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.parent = self
        uiView.tag = ChatDeckGestureTags.horizontalDeckViewTag
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: InteractiveDeckGestureOverlay
        weak var panRecognizer: UIPanGestureRecognizer?

        init(parent: InteractiveDeckGestureOverlay) {
            self.parent = parent
        }

        @objc func handleTap() {
            parent.onTap()
        }

        @objc func handlePan(_ pan: UIPanGestureRecognizer) {
            guard let view = pan.view else { return }
            let tx = pan.translation(in: view).x
            let vx = pan.velocity(in: view).x
            switch pan.state {
            case .began, .changed:
                parent.onDragChanged(tx)
            case .ended:
                parent.onDragEnded(tx, vx)
            case .cancelled, .failed:
                parent.onDragCancelled()
            default:
                break
            }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            if gestureRecognizer === panRecognizer, let view = gestureRecognizer.view {
                let v = (gestureRecognizer as? UIPanGestureRecognizer)?.velocity(in: view) ?? .zero
                let absVx = abs(v.x)
                let absVy = abs(v.y)
                // Only claim horizontal swipes; leave vertical drags cleanly to parent transcript ScrollView.
                return absVx > 22 && absVx > absVy * 1.4
            }
            return true
        }
    }
}

struct ChatStackedImageDeckView: View {
    let items: [LightboxImageItem]
    let token: String
    let palette: DragonClawPalette
    let onOpenLightbox: ([LightboxImageItem], Int) -> Void

    @State private var activeIndex: Int = 0
    @State private var dragOffsetX: CGFloat = 0

    private let cardWidth: CGFloat = 204
    private let cardHeight: CGFloat = 248

    private var safeActive: Int {
        guard !items.isEmpty else { return 0 }
        return ((activeIndex % items.count) + items.count) % items.count
    }

    var body: some View {
        if items.isEmpty {
            EmptyView()
        } else if items.count == 1, let single = items.first {
            AuthenticatedRemoteImageView(
                urlString: single.urlString,
                token: token,
                alt: single.title,
                adaptiveMaxWidth: 246,
                cornerRadius: 16,
                palette: palette
            ) { _ in
                onOpenLightbox(items, 0)
            }
        } else {
            let count = items.count
            let visibleDepths = min(3, count)
            let peekWidth: CGFloat = visibleDepths >= 3 ? 30 : 16
            let current = safeActive
            let prevIdx = (current - 1 + count) % count
            let draggingRight = dragOffsetX > 3
            let rightProgress = draggingRight ? min(1, max(0, dragOffsetX / (cardWidth * 0.62))) : 0
            let leftProgress = dragOffsetX < -3 ? min(1, max(0, -dragOffsetX / (cardWidth * 0.62))) : 0

            VStack(alignment: .center, spacing: 8) {
                ZStack(alignment: .leading) {
                    ForEach((0..<visibleDepths).reversed(), id: \.self) { depth in
                        let idx = (current + depth) % count
                        if !(draggingRight && depth > 0 && idx == prevIdx) {
                            let isFront = depth == 0
                            let metrics = layerMetrics(
                                depth: depth,
                                draggingRight: draggingRight,
                                leftProgress: leftProgress,
                                rightProgress: rightProgress
                            )
                            deckCard(
                                item: items[idx],
                                isFront: isFront && !draggingRight,
                                counterText: (isFront && !draggingRight) ? "\(current + 1) / \(count)" : nil
                            )
                            .frame(width: cardWidth, height: cardHeight)
                            .scaleEffect(metrics.scale)
                            .rotationEffect(.degrees(metrics.rotation))
                            .offset(x: metrics.offsetX)
                            .opacity(metrics.opacity)
                            .zIndex(Double(visibleDepths - depth))
                        }
                    }

                    if draggingRight {
                        deckCard(
                            item: items[prevIdx],
                            isFront: true,
                            counterText: "\(prevIdx + 1) / \(count)"
                        )
                        .frame(width: cardWidth, height: cardHeight)
                        .scaleEffect(0.92 + 0.08 * rightProgress)
                        .rotationEffect(.degrees(3.2 * (1 - rightProgress)))
                        .offset(x: -cardWidth * 0.56 * (1 - rightProgress))
                        .opacity(min(1, max(0, 0.40 + 0.60 * rightProgress)))
                        .zIndex(10)
                    }
                }
                .frame(width: cardWidth + peekWidth, height: cardHeight, alignment: .leading)
                .overlay(
                    InteractiveDeckGestureOverlay(
                        onTap: {
                            onOpenLightbox(items, safeActive)
                        },
                        onDragChanged: { tx in
                            dragOffsetX = min(cardWidth * 0.95, max(-cardWidth * 0.95, tx))
                        },
                        onDragEnded: { tx, vx in
                            let clamped = min(cardWidth * 0.95, max(-cardWidth * 0.95, tx))
                            let threshold = cardWidth * 0.24
                            if clamped < -threshold || vx < -340 {
                                withAnimation(.spring(response: 0.30, dampingFraction: 0.84)) {
                                    activeIndex = (safeActive + 1) % count
                                    dragOffsetX = 0
                                }
                            } else if clamped > threshold || vx > 340 {
                                withAnimation(.spring(response: 0.30, dampingFraction: 0.84)) {
                                    activeIndex = (safeActive - 1 + count) % count
                                    dragOffsetX = 0
                                }
                            } else {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                                    dragOffsetX = 0
                                }
                            }
                        },
                        onDragCancelled: {
                            withAnimation(.spring(response: 0.26, dampingFraction: 0.84)) {
                                dragOffsetX = 0
                            }
                        }
                    )
                )

                HStack(spacing: 5) {
                    ForEach(0..<min(count, 8), id: \.self) { dotIdx in
                        let active = dotIdx == current
                        Capsule()
                            .fill(active ? palette.accentStrong : palette.inkMuted.opacity(0.34))
                            .frame(width: active ? 14 : 5, height: 5)
                    }
                }
                .frame(width: cardWidth)
            }
            .onChange(of: items.map(\.urlString)) { _, _ in
                activeIndex = 0
                dragOffsetX = 0
            }
        }
    }

    private func layerMetrics(
        depth: Int,
        draggingRight: Bool,
        leftProgress: CGFloat,
        rightProgress: CGFloat
    ) -> (offsetX: CGFloat, scale: CGFloat, rotation: Double, opacity: Double) {
        if draggingRight {
            let offsetX: CGFloat = switch depth {
            case 0: 15 * 0.65 * rightProgress
            case 1: 15 + 13 * rightProgress
            default: 28
            }
            let scale: CGFloat = switch depth {
            case 0: 1.0 - 0.05 * rightProgress
            case 1: 0.94 - 0.05 * rightProgress
            default: 0.88
            }
            let rotation: Double = depth == 0 ? Double(1.5 * rightProgress) : 1.4
            let opacity: Double = switch depth {
            case 0: Double(1.0 - 0.08 * rightProgress)
            case 1: 0.95
            default: 0.88
            }
            return (offsetX, scale, rotation, opacity)
        } else {
            let offsetX: CGFloat = switch depth {
            case 0: dragOffsetX
            case 1: 15 * (1 - leftProgress)
            default: 28 - 13 * leftProgress
            }
            let scale: CGFloat = switch depth {
            case 0: 1.0 - 0.04 * leftProgress
            case 1: 0.94 + 0.06 * leftProgress
            default: 0.88 + 0.06 * leftProgress
            }
            let rotation: Double = switch depth {
            case 0: Double(-4.2 * leftProgress)
            case 1: Double(1.4 * (1 - leftProgress))
            default: Double(2.4 - 1.0 * leftProgress)
            }
            let opacity: Double = switch depth {
            case 0: Double(1.0 - 0.14 * leftProgress)
            case 1: Double(0.95 + 0.05 * leftProgress)
            default: Double(0.88 + 0.07 * leftProgress)
            }
            return (offsetX, scale, rotation, opacity)
        }
    }

    private func deckCard(
        item: LightboxImageItem,
        isFront: Bool,
        counterText: String?
    ) -> some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        return ZStack(alignment: .bottomTrailing) {
            AuthenticatedRemoteImageView(
                urlString: item.urlString,
                token: token,
                alt: item.title,
                fixedSize: CGSize(width: cardWidth - 8, height: cardHeight - 8),
                adaptiveMaxWidth: nil,
                cornerRadius: 16,
                innerPadding: 6,
                palette: palette,
                onTap: nil
            )
            .padding(4)

            if let counterText {
                HStack(spacing: 4) {
                    Text(counterText)
                        .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                        .foregroundStyle(.white)
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 9.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.black.opacity(0.56), in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.22), lineWidth: 0.6))
                .padding(10)
            }
        }
        .frame(width: cardWidth, height: cardHeight)
        .background(palette.cardSurface.opacity(palette.isDark ? 0.94 : 0.98), in: shape)
        .overlay(
            shape.stroke(
                isFront ? (palette.isDark ? Color.white.opacity(0.16) : Color.black.opacity(0.10)) : palette.hairLine,
                lineWidth: isFront ? 1.0 : 0.75
            )
        )
        .shadow(
            color: Color.black.opacity(palette.isDark ? (isFront ? 0.36 : 0.22) : (isFront ? 0.14 : 0.07)),
            radius: isFront ? 12 : 5,
            x: 0,
            y: isFront ? 5 : 2
        )
    }
}

struct ChatAttachmentGalleryView: View {
    let attachments: [ChatAttachment]
    let token: String
    let baseUrl: String
    let palette: DragonClawPalette
    let onOpenLightbox: ([LightboxImageItem], Int) -> Void

    private var imageAttachments: [ChatAttachment] {
        attachments.filter(\.isImage)
    }

    private var fileAttachments: [ChatAttachment] {
        attachments.filter { !$0.isImage }
    }

    private var lightboxItems: [LightboxImageItem] {
        imageAttachments.map { att in
            LightboxImageItem(
                urlString: DragonClawHelpers.shared.resolveAttachmentUrl(baseUrl: baseUrl, attachment: att),
                title: att.displayName
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !imageAttachments.isEmpty {
                let items = lightboxItems
                if imageAttachments.count == 1, let single = imageAttachments.first {
                    let url = items.first?.urlString ?? ""
                    AuthenticatedRemoteImageView(
                        urlString: url,
                        token: token,
                        alt: single.displayName,
                        adaptiveMaxWidth: 246,
                        cornerRadius: 16,
                        palette: palette
                    ) { _ in
                        onOpenLightbox(items, 0)
                    }
                } else {
                    ChatStackedImageDeckView(
                        items: items,
                        token: token,
                        palette: palette,
                        onOpenLightbox: onOpenLightbox
                    )
                }
            }

            if !fileAttachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(fileAttachments.enumerated()), id: \.offset) { _, file in
                            HStack(spacing: 5) {
                                Image(systemName: "doc.text.fill")
                                    .font(.caption2)
                                    .foregroundStyle(palette.accentStrong)
                                Text(file.displayName)
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(palette.inkPrimary)
                                    .lineLimit(1)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(palette.elevatedSurface.opacity(0.9), in: Capsule())
                            .overlay(Capsule().stroke(palette.hairLine, lineWidth: 0.75))
                        }
                    }
                }
            }
        }
    }
}

struct ImageLightboxOverlay: View {
    let payload: LightboxPayload
    @Environment(\.dismiss) private var dismiss

    @State private var currentIndex: Int
    @State private var loadedImages: [Int: UIImage] = [:]
    @State private var shareSheetImage: UIImage?

    init(payload: LightboxPayload) {
        self.payload = payload
        _currentIndex = State(initialValue: min(max(0, payload.initialIndex), max(0, payload.items.count - 1)))
    }

    private var currentTitle: String {
        guard payload.items.indices.contains(currentIndex) else { return "" }
        return payload.items[currentIndex].title
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $currentIndex) {
                ForEach(Array(payload.items.enumerated()), id: \.offset) { idx, item in
                    ZoomableLightboxPage(
                        item: item,
                        token: payload.token,
                        onLoaded: { img in loadedImages[idx] = img }
                    )
                    .tag(idx)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: payload.items.count > 1 ? .automatic : .never))

            VStack {
                HStack(spacing: 12) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(.ultraThinMaterial, in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)

                    VStack(alignment: .leading, spacing: 2) {
                        if !currentTitle.isEmpty {
                            Text(currentTitle)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                        }
                        if payload.items.count > 1 {
                            Text("\(currentIndex + 1) / \(payload.items.count)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.white.opacity(0.72))
                        }
                    }

                    Spacer()

                    if let activeImage = loadedImages[currentIndex] {
                        Button {
                            shareSheetImage = activeImage
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 40, height: 40)
                                .background(.ultraThinMaterial, in: Circle())
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)

                Spacer()
            }
        }
        .sheet(
            isPresented: Binding(
                get: { shareSheetImage != nil },
                set: { if !$0 { shareSheetImage = nil } }
            )
        ) {
            if let img = shareSheetImage {
                ActivityShareController(activityItems: [img])
            }
        }
    }
}

private struct ZoomableLightboxPage: View {
    let item: LightboxImageItem
    let token: String
    let onLoaded: (UIImage) -> Void

    @State private var image: UIImage?
    @State private var failed = false
    @State private var scale: CGFloat = 1
    @State private var steadyScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var steadyOffset: CGSize = .zero

    var body: some View {
        ZStack {
            if let img = image {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                scale = min(4.5, max(1.0, steadyScale * value))
                            }
                            .onEnded { _ in
                                if scale <= 1.05 {
                                    withAnimation(.spring(response: 0.25, dampingFraction: 0.85)) {
                                        scale = 1
                                        steadyScale = 1
                                        offset = .zero
                                        steadyOffset = .zero
                                    }
                                } else {
                                    steadyScale = scale
                                }
                            }
                    )
                    .simultaneousGesture(
                        scale > 1.05
                            ? DragGesture()
                                .onChanged { value in
                                    offset = CGSize(
                                        width: steadyOffset.width + value.translation.width,
                                        height: steadyOffset.height + value.translation.height
                                    )
                                }
                                .onEnded { _ in
                                    steadyOffset = offset
                                }
                            : nil
                    )
                    .onTapGesture(count: 2) {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) {
                            if scale > 1.2 {
                                scale = 1
                                steadyScale = 1
                                offset = .zero
                                steadyOffset = .zero
                            } else {
                                scale = 2.2
                                steadyScale = 2.2
                            }
                        }
                    }
            } else if failed {
                VStack(spacing: 10) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.largeTitle)
                        .foregroundStyle(.white.opacity(0.65))
                    Text(item.title.isEmpty ? "无法加载图片" : item.title)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.75))
                }
            } else {
                ProgressView()
                    .tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: item.urlString) {
            failed = false
            if let loaded = await AuthenticatedImageCache.shared.load(urlString: item.urlString, token: token) {
                image = loaded
                onLoaded(loaded)
            } else {
                failed = true
            }
        }
    }
}

private struct ActivityShareController: UIViewControllerRepresentable {
    let activityItems: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
