import SwiftUI

/// Visual tokens matching tools-platform Web Homepage v2 (light-first + crisp dark mode) paired with iOS 26 Liquid Glass.
struct DragonClawPalette {
    let isDark: Bool

    var background: Color { isDark ? Color(hex: 0x0F1115) : Color(hex: 0xFFFFFF) }
    var elevatedSurface: Color { isDark ? Color(hex: 0x15181D) : Color(hex: 0xF7F7F8) }
    var cardSurface: Color { isDark ? Color(hex: 0x1B1F26) : Color(hex: 0xFFFFFF) }
    var chipSurface: Color { isDark ? Color(hex: 0x1E232B) : Color(hex: 0xF2F2F4) }
    var userBubble: Color { isDark ? Color(hex: 0x1F2937) : Color(hex: 0xEFF7F4) }
    var hairLine: Color { isDark ? Color.white.opacity(0.09) : Color.black.opacity(0.08) }

    var inkPrimary: Color { isDark ? Color(hex: 0xE6E8EB) : Color(hex: 0x1F2328) }
    var inkSecondary: Color { isDark ? Color(hex: 0xB3B9C2) : Color(hex: 0x4B5563) }
    var inkMuted: Color { isDark ? Color(hex: 0x8D96A3) : Color(hex: 0x69717D) }

    var accent: Color { isDark ? Color(hex: 0x3ECF9E) : Color(hex: 0x10A37F) }
    var accentStrong: Color { isDark ? Color(hex: 0x10A37F) : Color(hex: 0x087F62) }
    var danger: Color { Color(hex: 0xEF4444) }
    var warning: Color { Color(hex: 0xF59E0B) }
    var info: Color { Color(hex: 0x3B82F6) }

    var ambientGlowPrimary: Color {
        accent.opacity(isDark ? 0.16 : 0.10)
    }

    var ambientGlowSecondary: Color {
        Color(hex: isDark ? 0x1E3A8A : 0x06B6D4).opacity(isDark ? 0.14 : 0.08)
    }

    static func current(_ colorScheme: ColorScheme) -> DragonClawPalette {
        DragonClawPalette(isDark: colorScheme == .dark)
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

enum L10n {
    static func tr(_ language: String, zh: String, en: String) -> String {
        language == "en" ? en : zh
    }
}
