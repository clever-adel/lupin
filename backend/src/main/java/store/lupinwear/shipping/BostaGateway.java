package store.lupinwear.shipping;

import java.math.BigDecimal;
import java.util.List;

/** The calls we make to Bosta. An interface so tests never touch the network. */
public interface BostaGateway {

    record District(String districtId, String name, String nameAr, boolean dropOff) {
    }

    record NewDelivery(String businessReference, BigDecimal cod, String cityName, String districtId,
            String addressLine, String landmark, String firstName, String lastName, String phone, String email,
            String packageDescription, int itemsCount, String packageType, String notes, String businessLocationId,
            String webhookUrl, String webhookHeader, String webhookSecret) {
    }

    record Created(String deliveryId, String trackingNumber) {
    }

    /** Bosta's public district list for one of its cities. */
    List<District> districts(String bostaCityId);

    Created createDelivery(NewDelivery delivery);
}
