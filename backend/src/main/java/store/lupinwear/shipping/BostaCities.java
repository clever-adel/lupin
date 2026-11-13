package store.lupinwear.shipping;

import java.util.Map;
import java.util.Optional;

/**
 * Our 27 governorates and Bosta's names and ids for them. Taken from Bosta's public cities list
 * (GET https://app.bosta.co/api/v2/cities?countryId=60e4482c7cb7d4bc4849c4d5) on 2026-11-12.
 * Bosta spells several differently (Assuit, Bani Suif, Behira, El Kalioubia, Kafr Alsheikh, Menya).
 * Bosta does not deliver to North Sinai.
 */
public final class BostaCities {

    public record City(String name, String id, boolean dropOff) {
    }

    static final Map<String, City> BY_GOVERNORATE = Map.ofEntries(
            Map.entry("cairo", new City("Cairo", "FceDyHXwpSYYF9zGW", true)),
            Map.entry("giza", new City("Giza", "0064Qb0OgcA", true)),
            Map.entry("alexandria", new City("Alexandria", "Jrb6X6ucjiYgMP4T7", true)),
            Map.entry("qalyubia", new City("El Kalioubia", "yp3atroeTwnyiBNKE", true)),
            Map.entry("dakahlia", new City("Dakahlia", "RrDhS8YYsXAwZ9Zfo", true)),
            Map.entry("sharqia", new City("Sharqia", "6ExcoGbpYHnggP8JD", true)),
            Map.entry("gharbia", new City("Gharbia", "K3RwC677J8kJytdZD", true)),
            Map.entry("monufia", new City("Monufia", "ruBSjGBDX9wpRa3cc", true)),
            Map.entry("beheira", new City("Behira", "g3GchTSmCgR2JynsJ", true)),
            Map.entry("kafr-el-sheikh", new City("Kafr Alsheikh", "ByP7rFCjL6XzF6j4S", true)),
            Map.entry("damietta", new City("Damietta", "qoZvYcZ8Cqji4pGp5", true)),
            Map.entry("port-said", new City("Port Said", "skFtf6ZmKo8kBEBDK", true)),
            Map.entry("ismailia", new City("Ismailia", "PJqNriLtFtx2cfkKP", true)),
            Map.entry("suez", new City("Suez", "PickurJ5uJZ9rDTHW", true)),
            Map.entry("north-sinai", new City("North Sinai", "ZuCaDAVQlPT", false)),
            Map.entry("south-sinai", new City("South Sinai", "nG_c44vHQht", true)),
            Map.entry("fayoum", new City("Fayoum", "BW5MiNxEirB7tuz2y", true)),
            Map.entry("beni-suef", new City("Bani Suif", "LzbbvTzZ7D2CgE2PL", true)),
            Map.entry("minya", new City("Menya", "si6eLnKjXqTFTMBj9", true)),
            Map.entry("assiut", new City("Assuit", "7mDPAohM3ArSZmWTm", true)),
            Map.entry("sohag", new City("Sohag", "n3EENg2adhuR9xBZK", true)),
            Map.entry("qena", new City("Qena", "vfTHTes3uGjAszgtg", true)),
            Map.entry("luxor", new City("Luxor", "wgYEdH2WMzxGE2Ztp", true)),
            Map.entry("aswan", new City("Aswan", "kLvZ5JY6LJPL5chzN", true)),
            Map.entry("red-sea", new City("Red Sea", "r5TscLCNSjR2GimxQ", true)),
            Map.entry("new-valley", new City("New Valley", "w4yDVHVJWqa4HpbzA", true)),
            Map.entry("matrouh", new City("Matrouh", "KBpGiRZJMIx", true)));

    private BostaCities() {
    }

    public static Optional<City> forGovernorate(String code) {
        return Optional.ofNullable(code == null ? null : BY_GOVERNORATE.get(code));
    }
}
