package dev.ascape.player;

import javax.sql.DataSource;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.metrics.micrometer.MicrometerMetricsTrackerFactory;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Chooses the JDBC store when {@code ascape.persistence.jdbc-url} is set, otherwise an in-memory one. */
@Configuration
public class PersistenceConfig {

	private static final Logger log = LoggerFactory.getLogger(PersistenceConfig.class);
	/** The Supabase session pooler caps connections per role; the server needs very few. */
	private static final int MAX_POOL_SIZE = 4;
	/** Every query here is short; holding a connection this long means something forgot to close it. */
	private static final long LEAK_DETECTION_MILLIS = 10_000;

	@ConfigurationProperties("ascape.persistence")
	public record PersistenceProperties(String jdbcUrl, String username, String password) {

		public boolean enabled() {
			return jdbcUrl != null && !jdbcUrl.isBlank();
		}
	}

	@Bean
	PlayerStore playerStore(PersistenceProperties properties, MeterRegistry registry) {
		if (!properties.enabled()) {
			log.warn("ascape.persistence.jdbc-url is not set: profiles and stats are kept in memory only");
			return new InMemoryPlayerStore();
		}
		DataSource dataSource = dataSource(properties, registry);
		PersistenceQueue writes = new PersistenceQueue(registry);
		return new ClosingJdbcPlayerStore(JdbcClient.create(dataSource),
				new TransactionTemplate(new DataSourceTransactionManager(dataSource)), writes, dataSource);
	}

	private static HikariDataSource dataSource(PersistenceProperties properties, MeterRegistry registry) {
		HikariConfig config = new HikariConfig();
		config.setJdbcUrl(properties.jdbcUrl());
		config.setUsername(properties.username());
		config.setPassword(properties.password());
		config.setMaximumPoolSize(MAX_POOL_SIZE);
		config.setPoolName("ascape-db");
		// The pool is built here rather than as a bean, so Boot's metrics auto-configuration does not see it:
		// bind it (hikaricp_connections*) and let Hikari log connections held far longer than any query needs.
		config.setMetricsTrackerFactory(new MicrometerMetricsTrackerFactory(registry));
		config.setLeakDetectionThreshold(LEAK_DETECTION_MILLIS);
		return new HikariDataSource(config);
	}

	/** Drains queued writes, then closes the pool, when the application shuts down. */
	static final class ClosingJdbcPlayerStore extends JdbcPlayerStore implements AutoCloseable {

		private final PersistenceQueue writes;
		private final DataSource dataSource;

		ClosingJdbcPlayerStore(JdbcClient jdbc, TransactionTemplate transactions, PersistenceQueue writes,
				DataSource dataSource) {
			super(jdbc, transactions, writes);
			this.writes = writes;
			this.dataSource = dataSource;
		}

		@Override
		public void close() throws Exception {
			writes.close();
			if (dataSource instanceof HikariDataSource hikari) {
				hikari.close();
			}
		}
	}
}
