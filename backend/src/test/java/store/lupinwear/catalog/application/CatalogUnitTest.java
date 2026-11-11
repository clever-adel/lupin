package store.lupinwear.catalog.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import store.lupinwear.catalog.application.CatalogQueryService.Sort;
import store.lupinwear.shared.ApiException;

/** Pure logic, no Spring and no database. */
class CatalogUnitTest {

    @Test
    void discountPercentIsRoundedToTheNearestWholeNumber() {
        assertThat(CatalogQueryService.discountPercent(new BigDecimal("2750.00"), new BigDecimal("2200.00"))).isEqualTo(20);
        assertThat(CatalogQueryService.discountPercent(new BigDecimal("2300.00"), new BigDecimal("2070.00"))).isEqualTo(10);
        assertThat(CatalogQueryService.discountPercent(new BigDecimal("999.00"), new BigDecimal("666.00"))).isEqualTo(33);
        assertThat(CatalogQueryService.discountPercent(new BigDecimal("1000.00"), new BigDecimal("995.00"))).isEqualTo(1);
    }

    @Test
    void noDiscountPercentWithoutASalePriceOrWithANonsensePrice() {
        assertThat(CatalogQueryService.discountPercent(new BigDecimal("1000.00"), null)).isNull();
        assertThat(CatalogQueryService.discountPercent(BigDecimal.ZERO, new BigDecimal("1.00"))).isNull();
        assertThat(CatalogQueryService.discountPercent(null, new BigDecimal("1.00"))).isNull();
    }

    @Test
    void sortFallsBackToFeaturedForAnythingUnknown() {
        assertThat(Sort.parse("price_asc")).isEqualTo(Sort.PRICE_ASC);
        assertThat(Sort.parse(" NEWEST ")).isEqualTo(Sort.NEWEST);
        assertThat(Sort.parse(null)).isEqualTo(Sort.FEATURED);
        assertThat(Sort.parse("p.price; drop table products")).isEqualTo(Sort.FEATURED);
    }

    @Test
    void slugsAreLowercaseAsciiWithDashes() {
        assertThat(CatalogAdminService.slugify("Night Bomber")).isEqualTo("night-bomber");
        assertThat(CatalogAdminService.slugify("  Café  Racer — 2.0!  ")).isEqualTo("cafe-racer-2-0");
        assertThat(CatalogAdminService.slugify("A/B\\C?D#E")).isEqualTo("a-b-c-d-e");
        assertThat(CatalogAdminService.slugify("x".repeat(150))).hasSize(100);
    }

    @Test
    void aNameWithNoLettersOrNumbersCannotBecomeASlug() {
        assertThatThrownBy(() -> CatalogAdminService.slugify("جاكيت"))
                .isInstanceOf(ApiException.class).hasMessageContaining("English name");
        assertThatThrownBy(() -> CatalogAdminService.slugify(" — "))
                .isInstanceOf(ApiException.class);
    }
}
