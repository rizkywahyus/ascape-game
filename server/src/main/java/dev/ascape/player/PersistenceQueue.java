package dev.ascape.player;

import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Bounded queue of database writes executed one at a time on a virtual thread, so game code never waits on
 * the database. When the database cannot keep up, new writes are dropped (and counted) rather than queued forever.
 */
public final class PersistenceQueue implements AutoCloseable {

	private static final Logger log = LoggerFactory.getLogger(PersistenceQueue.class);
	private static final int CAPACITY = 1_000;
	private static final long POLL_MILLIS = 200;
	private static final Duration SHUTDOWN_DRAIN_TIMEOUT = Duration.ofSeconds(5);

	private final BlockingQueue<NamedWrite> queue = new ArrayBlockingQueue<>(CAPACITY);
	private final Counter dropped;
	private final Counter failed;
	private final Thread worker;
	private volatile boolean closing;

	private record NamedWrite(String name, Runnable write) {
	}

	public PersistenceQueue(MeterRegistry registry) {
		this.dropped = Counter.builder("ascape.persistence.dropped").register(registry);
		this.failed = Counter.builder("ascape.persistence.failed").register(registry);
		this.worker = Thread.ofVirtual().name("persistence").start(this::run);
	}

	public void submit(String name, Runnable write) {
		if (closing) {
			log.warn("Persistence queue closed, dropping write '{}'", name);
			dropped.increment();
			return;
		}
		if (!queue.offer(new NamedWrite(name, write))) {
			dropped.increment();
			log.warn("Persistence queue full, dropping write '{}'", name);
		}
	}

	private void run() {
		while (!closing || !queue.isEmpty()) {
			NamedWrite next;
			try {
				next = queue.poll(POLL_MILLIS, TimeUnit.MILLISECONDS);
			}
			catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return;
			}
			if (next == null) {
				continue;
			}
			try {
				next.write().run();
			}
			catch (RuntimeException e) {
				failed.increment();
				log.error("Persistence write '{}' failed", next.name(), e);
			}
		}
	}

	/** Stops accepting writes and waits briefly for queued ones (e.g. final match results) to finish. */
	@Override
	public void close() throws InterruptedException {
		closing = true;
		if (!worker.join(SHUTDOWN_DRAIN_TIMEOUT)) {
			log.warn("Persistence queue still had {} writes at shutdown", queue.size());
			worker.interrupt();
		}
	}
}
