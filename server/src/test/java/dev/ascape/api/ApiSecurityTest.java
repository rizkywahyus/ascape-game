package dev.ascape.api;

import static org.hamcrest.Matchers.startsWith;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class ApiSecurityTest {

	@Autowired
	MockMvc mvc;

	@Test
	void meRequiresToken() throws Exception {
		mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
	}

	@Test
	void meCreatesProfileFromToken() throws Exception {
		String userId = UUID.randomUUID().toString();
		mvc.perform(get("/api/me").with(jwt().jwt(token -> token.subject(userId).claim("email", "Ada.L@example.com"))))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(userId))
				.andExpect(jsonPath("$.username").value("adal"))
				.andExpect(jsonPath("$.glyph").value("@"));
	}

	@Test
	void anonymousUsersGetGuestNames() throws Exception {
		mvc.perform(get("/api/me").with(jwt().jwt(token -> token.subject(UUID.randomUUID().toString()))))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.username").value(startsWith("guest-")));
	}

	@Test
	void updatesProfileAndValidatesFields() throws Exception {
		String userId = UUID.randomUUID().toString();
		var auth = jwt().jwt(token -> token.subject(userId));

		mvc.perform(patch("/api/me").with(auth).contentType(MediaType.APPLICATION_JSON)
				.content("{\"username\":\"lamplighter\",\"glyph\":\"$\",\"color\":\"#5dade2\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.username").value("lamplighter"))
				.andExpect(jsonPath("$.glyph").value("$"));

		mvc.perform(patch("/api/me").with(auth).contentType(MediaType.APPLICATION_JSON)
				.content("{\"glyph\":\"M\"}"))
				.andExpect(status().isBadRequest());
		mvc.perform(patch("/api/me").with(auth).contentType(MediaType.APPLICATION_JSON)
				.content("{\"color\":\"#101010\"}"))
				.andExpect(status().isBadRequest());
	}

	@Test
	void publicEndpointsNeedNoToken() throws Exception {
		mvc.perform(get("/api/rooms")).andExpect(status().isOk());
		mvc.perform(get("/api/leaderboard?kind=monster")).andExpect(status().isOk());
		mvc.perform(get("/actuator/health")).andExpect(status().isOk());
	}

	@Test
	void everythingElseIsDenied() throws Exception {
		mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
	}
}
