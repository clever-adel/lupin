package store.lupinwear.admin;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ReportCsvUnitTest {

    @Test
    void quotesEveryValueAndDoublesQuotes() {
        assertThat(AdminReportController.row("A", "say \"hi\"", null, "مدينة نصر"))
                .isEqualTo("\"A\",\"say \"\"hi\"\"\",\"\",\"مدينة نصر\"\r\n");
    }

    @Test
    void keepsSpreadsheetFormulasFromRunning() {
        assertThat(AdminReportController.row("=HYPERLINK(\"x\")", "+20", "-1", "@SUM(A1)"))
                .isEqualTo("\"'=HYPERLINK(\"\"x\"\")\",\"'+20\",\"'-1\",\"'@SUM(A1)\"\r\n");
    }
}
