package store.lupinwear.review;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ReviewUnitTest {

    @Test
    void showsTheFirstNameAndAnInitialOnly() {
        assertThat(ReviewController.shortName("Ahmed Mohamed Ali")).isEqualTo("Ahmed M.");
        assertThat(ReviewController.shortName("  أحمد   محمد ")).isEqualTo("أحمد م.");
        assertThat(ReviewController.shortName("Mona")).isEqualTo("Mona");
        assertThat(ReviewController.shortName(null)).isEmpty();
    }
}
