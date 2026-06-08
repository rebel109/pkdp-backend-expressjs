const db = require('./config/db');

async function debugUploadWindows() {
  try {
    const narasumberId = 213; // seraga
    const classId = 2; // 1B

    console.log(`\n=== DEBUG UPLOAD WINDOWS ===\n`);

    // Cari task video di 1B
    const [[videoTask1B]] = await db.query(`
      SELECT t.id, t.title, t.class_id, t.upload_open, t.upload_close
      FROM tasks t
      WHERE t.class_id=? AND t.title LIKE '%Video%'
        AND t.phase IN ('OJC', 'ISC2')
        AND t.task_type='UPLOAD'
      LIMIT 1
    `, [classId]);

    if (!videoTask1B) {
      console.log('Video task di 1B tidak ditemukan');
      process.exit(0);
    }

    console.log(`Target Task (Video di 1B):`);
    console.log(`  ID: ${videoTask1B.id}`);
    console.log(`  Title: ${videoTask1B.title}`);
    console.log(`  Upload Open: ${videoTask1B.upload_open}`);
    console.log(`  Upload Close: ${videoTask1B.upload_close}`);

    // Cari upload windows untuk task yang sudah ditugaskan ke seraga di kelas LAIN
    console.log(`\n--- Upload Windows (Seraga di kelas lain) ---`);
    const [otherWindows] = await db.query(`
      SELECT t.id, t.title, t.upload_open, t.upload_close, c.name as class_name
      FROM class_narasumber cn
      JOIN tasks t ON t.id=cn.material_id
      JOIN classes c ON c.id=cn.class_id
      WHERE cn.narasumber_id=? AND cn.class_id<>?
        AND t.upload_open IS NOT NULL AND t.upload_close IS NOT NULL
    `, [narasumberId, classId]);

    otherWindows.forEach(w => {
      console.log(`  Task: ${w.title} (${w.class_name})`);
      console.log(`    Upload: ${w.upload_open} - ${w.upload_close}`);
    });

    // Cek overlap
    console.log(`\n--- OVERLAP CHECK ---`);
    if (videoTask1B.upload_open && videoTask1B.upload_close) {
      const twStart = new Date(videoTask1B.upload_open);
      const twEnd = new Date(videoTask1B.upload_close);

      let hasOverlap = false;
      for (const ow of otherWindows) {
        const owStart = new Date(ow.upload_open);
        const owEnd = new Date(ow.upload_close);
        const overlap = twStart < owEnd && twEnd > owStart;

        console.log(`\nTarget: ${twStart.toISOString()} - ${twEnd.toISOString()}`);
        console.log(`Other:  ${owStart.toISOString()} - ${owEnd.toISOString()}`);
        console.log(`Overlap: ${overlap}`);

        if (overlap) {
          console.log(`❌ BENTROK dengan ${ow.title} di ${ow.class_name}`);
          hasOverlap = true;
        }
      }

      if (!hasOverlap && otherWindows.length > 0) {
        console.log(`\n✅ Tidak ada overlap - seharusnya BERHASIL`);
      }
    } else {
      console.log('Target task tidak punya upload_open/upload_close');
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

debugUploadWindows();
