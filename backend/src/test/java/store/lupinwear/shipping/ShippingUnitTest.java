package store.lupinwear.shipping;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import store.lupinwear.shipping.BostaGateway.District;

import static org.assertj.core.api.Assertions.assertThat;

class ShippingUnitTest {

    static final ObjectMapper JSON = new ObjectMapper();

    /** Every governorate code seeded in V2__reference_data.sql. */
    static final List<String> GOVERNORATES = List.of("cairo", "giza", "alexandria", "qalyubia", "dakahlia", "sharqia",
            "gharbia", "monufia", "beheira", "kafr-el-sheikh", "damietta", "port-said", "ismailia", "suez",
            "north-sinai", "south-sinai", "fayoum", "beni-suef", "minya", "assiut", "sohag", "qena", "luxor", "aswan",
            "red-sea", "new-valley", "matrouh");

    @Test
    void everyGovernorateHasABostaCity() {
        for (String code : GOVERNORATES) {
            assertThat(BostaCities.forGovernorate(code)).as(code).isPresent();
        }
        assertThat(BostaCities.forGovernorate("north-sinai").orElseThrow().dropOff()).isFalse();
        assertThat(BostaCities.forGovernorate("cairo").orElseThrow().name()).isEqualTo("Cairo");
        assertThat(BostaCities.forGovernorate("atlantis")).isEmpty();
    }

    @Test
    void cashOnDeliveryOnlyForUnpaidCashOrders() {
        BigDecimal total = new BigDecimal("1060.00");
        assertThat(ShippingService.codAmount("COD", "PENDING", total)).isEqualByComparingTo("1060.00");
        assertThat(ShippingService.codAmount("COD", "PAID", total)).isEqualByComparingTo("0");
        assertThat(ShippingService.codAmount("CARD", "PAID", total)).isEqualByComparingTo("0");
        assertThat(ShippingService.codAmount("INSTAPAY_MANUAL", "VERIFYING", total)).isEqualByComparingTo("0");
    }

    @Test
    void districtIsSuggestedFromWhatTheCustomerTyped() {
        List<District> ds = List.of(new District("1", "Nasr City", "مدينة نصر", true),
                new District("2", "El Maadi", "المعادى", true), new District("3", "Heliopolis", "مصر الجديدة", true));
        assertThat(ShippingService.suggestDistrict("nasr city", ds)).isEqualTo("1");
        assertThat(ShippingService.suggestDistrict("Maadi", ds)).isEqualTo("2");
        assertThat(ShippingService.suggestDistrict("المعادي", ds)).isEqualTo("2");
        assertThat(ShippingService.suggestDistrict("Heliopolis, Korba", ds)).isEqualTo("3");
        assertThat(ShippingService.suggestDistrict("Zamalek", ds)).isNull();
        assertThat(ShippingService.suggestDistrict("", ds)).isNull();
        assertThat(ShippingService.suggestDistrict(null, ds)).isNull();

        // Bosta's real Cairo list (2026-11-12) has these next to each other.
        List<District> cairo = List.of(new District("g", "Maadi Gardens Compound Katameya", "كمبوند معادي جاردنز القطاميه", true),
                new District("m", "ElMaadi", "المعادي", true), new District("a", "Arab ElMaadi", "عرب المعادي", true),
                new District("n", "ElNasr", "النصر", true));
        assertThat(ShippingService.suggestDistrict("Maadi", cairo)).isEqualTo("m");
        assertThat(ShippingService.suggestDistrict("El Maadi", cairo)).isEqualTo("m");
        assertThat(ShippingService.suggestDistrict("معادي", cairo)).isEqualTo("m");
        assertThat(ShippingService.suggestDistrict("arab el maadi", cairo)).isEqualTo("a");
    }

    @Test
    void namesAreSplitIntoFirstAndLast() {
        assertThat(ShippingService.splitName("Mona  Ahmed Ali")).containsExactly("Mona", "Ahmed Ali");
        assertThat(ShippingService.splitName("Mona")).containsExactly("Mona", "Mona");
    }

    @Test
    void stateCodesAndTimestampsAreReadInEitherForm() throws Exception {
        assertThat(ShippingService.stateCode(JSON.readTree("45"))).isEqualTo(45);
        assertThat(ShippingService.stateCode(JSON.readTree("\"47\""))).isEqualTo(47);
        assertThat(ShippingService.stateCode(JSON.readTree("{\"code\":46,\"value\":\"Returned\"}"))).isEqualTo(46);
        assertThat(ShippingService.stateCode(JSON.readTree("\"delivered\""))).isNull();
        assertThat(ShippingService.label(JSON.readTree("{\"code\":999,\"value\":\"New state\"}"), 999))
                .isEqualTo("New state");
        assertThat(ShippingService.label(JSON.readTree("999"), 999)).isEqualTo("Bosta status 999");
        assertThat(ShippingService.label(JSON.readTree("45"), 45)).isEqualTo("Delivered");

        assertThat(ShippingService.timestamp(JSON.readTree("1700000000000")))
                .isEqualTo(Instant.ofEpochMilli(1_700_000_000_000L));
        assertThat(ShippingService.timestamp(JSON.readTree("\"2026-11-12T10:00:00Z\"")))
                .isEqualTo(Instant.parse("2026-11-12T10:00:00Z"));
        assertThat(ShippingService.timestamp(JSON.readTree("\"yesterday\""))).isNull();
    }

    @Test
    void settingsHideSecretsAndNeedBoth() {
        var none = new BostaProperties("", null, null, null, null, null);
        assertThat(none.configured()).isFalse();
        assertThat(none.baseUrl()).isEqualTo("https://app.bosta.co/api/v2");
        var shortSecret = new BostaProperties("key", null, "short", null, null, null);
        assertThat(shortSecret.configured()).isFalse();
        var ok = new BostaProperties("key-value", "https://example.test/api/v2/", "a-webhook-secret-of-24-chars+", null,
                null, null);
        assertThat(ok.configured()).isTrue();
        assertThat(ok.baseUrl()).isEqualTo("https://example.test/api/v2");
        assertThat(ok.toString()).doesNotContain("key-value").doesNotContain("a-webhook-secret");
    }
}
