package dev.ascape.game.room;

import java.util.concurrent.TimeUnit;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

/** Micrometer meters shared by all rooms. */
public final class RoomMetrics {

	private final Timer tickTimer;
	private final Counter bytesSent;

	public RoomMetrics(MeterRegistry registry) {
		this.tickTimer = Timer.builder("ascape.room.tick")
				.description("Duration of one room tick")
				.publishPercentiles(0.5, 0.95, 0.99)
				.register(registry);
		this.bytesSent = Counter.builder("ascape.net.bytes.sent")
				.description("WebSocket payload bytes sent to clients")
				.baseUnit("bytes")
				.register(registry);
	}

	void recordTick(long durationNanos) {
		tickTimer.record(durationNanos, TimeUnit.NANOSECONDS);
	}

	public void recordBytesSent(int bytes) {
		bytesSent.increment(bytes);
	}
}
