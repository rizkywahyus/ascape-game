package dev.ascape.net;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.Test;

class RateLimiterTest {

	private final AtomicLong now = new AtomicLong();
	private final RateLimiter limiter = new RateLimiter(10, 5, now::get);

	@Test
	void allowsABurstThenLimits() {
		for (int i = 0; i < 5; i++) {
			assertThat(limiter.tryAcquire()).isTrue();
		}
		assertThat(limiter.tryAcquire()).isFalse();
	}

	@Test
	void refillsAtTheSustainedRate() {
		for (int i = 0; i < 5; i++) {
			limiter.tryAcquire();
		}
		now.addAndGet(TimeUnit.MILLISECONDS.toNanos(100)); // 10/s → one token per 100 ms
		assertThat(limiter.tryAcquire()).isTrue();
		assertThat(limiter.tryAcquire()).isFalse();
	}

	@Test
	void neverStoresMoreThanTheBurst() {
		now.addAndGet(TimeUnit.SECONDS.toNanos(60));
		int allowed = 0;
		while (limiter.tryAcquire()) {
			allowed++;
		}
		assertThat(allowed).isEqualTo(5);
	}
}
