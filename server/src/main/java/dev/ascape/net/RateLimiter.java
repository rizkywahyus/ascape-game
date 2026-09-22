package dev.ascape.net;

import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

/**
 * Token bucket per connection: {@code ratePerSecond} sustained, bursts up to {@code burst}. Clients send 20 inputs
 * and a ping every 2 s, so the defaults leave ample headroom while stopping floods. Thread-safe.
 */
final class RateLimiter {

	private final double ratePerNano;
	private final double burst;
	private final LongSupplier clock;
	private double tokens;
	private long lastRefillNanos;

	RateLimiter(double ratePerSecond, double burst, LongSupplier nanoClock) {
		this.ratePerNano = ratePerSecond / TimeUnit.SECONDS.toNanos(1);
		this.burst = burst;
		this.clock = nanoClock;
		this.tokens = burst;
		this.lastRefillNanos = nanoClock.getAsLong();
	}

	synchronized boolean tryAcquire() {
		long now = clock.getAsLong();
		tokens = Math.min(burst, tokens + (now - lastRefillNanos) * ratePerNano);
		lastRefillNanos = now;
		if (tokens < 1) {
			return false;
		}
		tokens -= 1;
		return true;
	}
}
