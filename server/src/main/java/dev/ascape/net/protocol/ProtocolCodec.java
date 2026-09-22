package dev.ascape.net.protocol;

import java.util.Map;

import dev.ascape.net.protocol.ClientMessages.ChatSend;
import dev.ascape.net.protocol.ClientMessages.ClientMessage;
import dev.ascape.net.protocol.ClientMessages.Input;
import dev.ascape.net.protocol.ClientMessages.Join;
import dev.ascape.net.protocol.ClientMessages.Leave;
import dev.ascape.net.protocol.ClientMessages.Ping;
import dev.ascape.net.protocol.ClientMessages.Queue;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.stereotype.Component;

/** Encodes and decodes the {@code { "t": type, "d": payload }} envelope. */
@Component
public class ProtocolCodec {

	private static final Map<String, Class<? extends ClientMessage>> CLIENT_TYPES = Map.of(
			"queue", Queue.class,
			"join", Join.class,
			"leave", Leave.class,
			"input", Input.class,
			"chat", ChatSend.class,
			"ping", Ping.class);

	private final JsonMapper jsonMapper;

	public ProtocolCodec(JsonMapper jsonMapper) {
		this.jsonMapper = jsonMapper;
	}

	public String encode(ServerMessage message) {
		return jsonMapper.writeValueAsString(Map.of("t", message.type(), "d", message));
	}

	public ClientMessage decode(String text) {
		JsonNode envelope;
		try {
			envelope = jsonMapper.readTree(text);
		}
		catch (JacksonException e) {
			throw new ProtocolException("bad_message", "Envelope is not valid JSON");
		}
		JsonNode typeNode = envelope.get("t");
		if (typeNode == null || !typeNode.isString()) {
			throw new ProtocolException("bad_message", "Envelope lacks string field 't'");
		}
		Class<? extends ClientMessage> payloadType = CLIENT_TYPES.get(typeNode.asString());
		if (payloadType == null) {
			throw new ProtocolException("unknown_type", "Unsupported message type");
		}
		JsonNode payload = envelope.get("d");
		if (payload == null || !payload.isObject()) {
			throw new ProtocolException("bad_message", "Envelope lacks object field 'd'");
		}
		try {
			return jsonMapper.treeToValue(payload, payloadType);
		}
		catch (JacksonException e) {
			throw new ProtocolException("bad_message", "Invalid payload for '" + typeNode.asString() + "'");
		}
	}
}
