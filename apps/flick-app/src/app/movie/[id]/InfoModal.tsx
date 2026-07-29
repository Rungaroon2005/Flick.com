'use client';
import styles from './InfoModal.module.css';
import { Movie } from '@/types';

interface InfoModalProps {
  movie: Movie;
  onClose: () => void;
}

export default function InfoModal({ movie, onClose }: InfoModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <h2 className={styles.title}>{movie.title}</h2>
        
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>ระดับความเหมาะสม</h3>
          <div className={styles.tags}>
            <span className={styles.tag}>ภาษาไม่เหมาะสม</span>
            <span className={styles.tag}>ความรุนแรง</span>
            <span className={styles.tag}>13+</span>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>นักแสดง</h3>
          <p className={styles.text}>เจมส์ จิรายุ, เบลล่า ราณี, ชาย ชาตโยดม, แอน ทองประสม</p>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>ผู้กำกับ</h3>
          <p className={styles.text}>พงษ์พัฒน์ วชิรบรรจง</p>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>ผู้ผลิต</h3>
          <p className={styles.text}>บริษัท เมคเกอร์ เจ กรุ๊ป จำกัด</p>
        </div>
      </div>
    </div>
  );
}
