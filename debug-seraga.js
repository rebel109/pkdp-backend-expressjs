const db = require('./config/db');

async function debugSeraga() {
  try {
    // Cari user seraga
    const [[seraga]] = await db.query('SELECT id, name FROM users WHERE name = "seraga" LIMIT 1');

    if (!seraga) {
      console.log('Seraga tidak ditemukan');
      process.exit(0);
    }

    console.log(`\n=== Narasumber: ${seraga.name} (ID: ${seraga.id}) ===\n`);

    // Cari semua slots untuk seraga di 2026-06-08
    const [allSlots] = await db.query(`
      SELECT
        ss.id,
        ss.slot_date,
        ss.start_time,
        ss.end_time,
        c.name as class_name,
        t.title as task_title
      FROM schedule_slot_classes ssc
      JOIN schedule_slots ss ON ss.id = ssc.schedule_slot_id
      LEFT JOIN classes c ON c.id = ssc.class_id
      LEFT JOIN tasks t ON t.id = ss.task_id
      WHERE ssc.narasumber_id = ? AND ss.slot_date = '2026-06-08'
      ORDER BY ss.start_time
    `, [seraga.id]);

    console.log('=== SEMUA SLOTS UNTUK SERAGA DI 2026-06-08 ===\n');
    allSlots.forEach(slot => {
      console.log(`ID: ${slot.id}`);
      console.log(`  Kelas: ${slot.class_name}`);
      console.log(`  Tugas: ${slot.task_title || '(no task)'}`);
      console.log(`  Jam: ${slot.start_time} - ${slot.end_time}`);
      console.log('');
    });

    // Cari slots di 1B
    const [slots1B] = await db.query(`
      SELECT
        ss.id,
        ss.slot_date,
        ss.start_time,
        ss.end_time,
        t.title as task_title
      FROM schedule_slots ss
      JOIN schedule_slot_classes ssc ON ssc.schedule_slot_id = ss.id
      LEFT JOIN tasks t ON t.id = ss.task_id
      WHERE ssc.class_id = (SELECT id FROM classes WHERE name = '1B' LIMIT 1)
        AND ss.slot_date = '2026-06-08'
      ORDER BY ss.start_time
    `);

    console.log('=== SEMUA SLOTS DI KELAS 1B ===\n');
    slots1B.forEach(slot => {
      console.log(`ID: ${slot.id}, Jam: ${slot.start_time}-${slot.end_time}, Task: ${slot.task_title || '(no task)'}`);
    });

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

debugSeraga();
