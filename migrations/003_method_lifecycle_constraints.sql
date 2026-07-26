ALTER TABLE method_evidence
  ADD UNIQUE KEY method_evidence_method_review_unique (method_id, review_id),
  ADD KEY method_evidence_review_id_idx (review_id),
  ADD CONSTRAINT method_evidence_review_fk
    FOREIGN KEY (review_id) REFERENCES reviews(id);

ALTER TABLE method_versions
  ADD KEY method_versions_source_review_id_idx (source_review_id),
  ADD CONSTRAINT method_versions_source_review_fk
    FOREIGN KEY (source_review_id) REFERENCES reviews(id);

ALTER TABLE method_applications
  ADD UNIQUE KEY method_applications_item_id_unique (item_id),
  ADD KEY method_applications_method_version_idx (method_id, method_version);
