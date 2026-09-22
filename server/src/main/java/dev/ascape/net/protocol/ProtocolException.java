package dev.ascape.net.protocol;

/** A client sent something the protocol does not allow; {@link #code()} is sent back in an {@code error}. */
public class ProtocolException extends RuntimeException {

	private final String code;

	public ProtocolException(String code, String message) {
		super(message);
		this.code = code;
	}

	public String code() {
		return code;
	}
}
