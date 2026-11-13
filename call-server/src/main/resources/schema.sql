CREATE TABLE IF NOT EXISTS transport_call (
    id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    request_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    retry_of_call_id CHAR(36) CHARACTER SET ascii,
    status ENUM('PENDING','CONFIRMED','ALL_DECLINED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    report_snapshot JSON NOT NULL,
    applied_radius_km INT NOT NULL,
    confirmed_hpid VARCHAR(64),
    started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at TIMESTAMP(3) NULL,
    FOREIGN KEY (retry_of_call_id) REFERENCES transport_call(id),
    INDEX call_history_order (finished_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transport_call_hospital (
    call_id CHAR(36) CHARACTER SET ascii NOT NULL,
    hpid VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    candidate_rank TINYINT NOT NULL CHECK (candidate_rank BETWEEN 1 AND 3),
    hospital_snapshot JSON NOT NULL,
    status ENUM('PENDING','ACCEPTED','DECLINED','CLOSED_BY_CONFIRMATION','CANCELLED') NOT NULL DEFAULT 'PENDING',
    responded_at TIMESTAMP(3) NULL,
    PRIMARY KEY (call_id, hpid),
    UNIQUE (call_id, candidate_rank),
    FOREIGN KEY (call_id) REFERENCES transport_call(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
