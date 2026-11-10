package store.lupinwear.auth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "roles")
public class Role {

    public static final String CUSTOMER = "CUSTOMER";
    public static final String ADMIN = "ADMIN";
    public static final String OWNER = "OWNER";

    @Id
    private Short id;

    @Column(nullable = false, unique = true)
    private String code;

    protected Role() {
    }

    public String getCode() {
        return code;
    }
}
