'use client';

import { useModalDismiss } from '@/hooks/useModalDismiss';
import type { Movie } from '@/types';
import styles from './InfoModal.module.css';

interface InfoModalProps {
  movie: Movie;
  onClose: () => void;
}

export default function InfoModal({ movie, onClose }: InfoModalProps) {
  const dialogRef = useModalDismiss<HTMLDivElement>(onClose);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="movie-info-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="ปิดข้อมูลภาพยนตร์"
          data-modal-close
        >
          ✕
        </button>
        <h2 className={styles.title} id="movie-info-title">{movie.title}</h2>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>รายละเอียด</h3>
          <p className={styles.text}>{movie.description}</p>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>ข้อมูลเนื้อหา</h3>
          <div className={styles.tags}>
            <span className={styles.tag}>{movie.year}</span>
            <span className={styles.tag}>{movie.contentRating}</span>
            {movie.genres.map((genre) => (
              <span className={styles.tag} key={genre.id}>{genre.name}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
