package dev.ascape.player;

import java.util.Set;
import java.util.regex.Pattern;

/** Validation for user-editable profile fields; mirrored by the database CHECK constraints where possible. */
public final class ProfileRules {

	public static final String DEFAULT_GLYPH = "@";
	public static final String DEFAULT_COLOR = "#f5f0e0";

	private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_-]{3,24}");
	private static final Pattern COLOR = Pattern.compile("#[0-9a-fA-F]{6}");
	/** Glyphs that already mean something on the map or belong to the monster. */
	private static final Set<String> RESERVED_GLYPHS = Set.of("M", "&", "#", ".", "·", "[", "]", "≡", "■", "▓", "▯",
			"█", "^", ")", "E", "G", "L", "S");
	/** Relative luminance below this is unreadable on the near-black background. */
	private static final double MIN_LUMINANCE = 0.18;

	private ProfileRules() {
	}

	public static boolean isValidUsername(String username) {
		return username != null && USERNAME.matcher(username).matches();
	}

	/** One printable ASCII character, not whitespace and not reserved. */
	public static boolean isValidGlyph(String glyph) {
		return glyph != null && glyph.length() == 1 && glyph.charAt(0) > ' ' && glyph.charAt(0) < 127
				&& !RESERVED_GLYPHS.contains(glyph);
	}

	public static boolean isValidColor(String color) {
		return color != null && COLOR.matcher(color).matches() && luminance(color) >= MIN_LUMINANCE;
	}

	private static double luminance(String hex) {
		int rgb = Integer.parseInt(hex.substring(1), 16);
		return 0.2126 * linear((rgb >> 16) & 0xff) + 0.7152 * linear((rgb >> 8) & 0xff) + 0.0722 * linear(rgb & 0xff);
	}

	private static double linear(int channel) {
		double c = channel / 255.0;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	}
}
