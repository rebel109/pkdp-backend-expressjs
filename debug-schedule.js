const db = require('./config/db');

async function checkSchedule() {
  try {
    const [slots] = await db.query(`
      SELECT
        ss.id,
        ss.task_id,
        ss.slot_date,
        ss.start_time,
        ss.end_time,
        t.title,
        t.class_id,
        c.name as class_name,
        ssc.narasumber_id,
        u.name as narasumber_name
      FROM schedule_slots ss
      LEFT JOIN tasks t ON t.id=ss.task_id
      LEFT JOIN schedule_slot_classes ssc ON ssc.schedule_slot_id=ss.id
      LEFT JOIN classes c ON c.id=ssc.class_id
      LEFT JOIN users u ON u.id=ssc.narasumber_id
      WHERE ss.slot_date='2026-06-08'
      ORDER BY ss.start_time, c.name
    `);

    console.log('\n=== SCHEDULE SLOTS untuk 2026-06-08 ===\n');
    slots.forEach(slot => {
      console.log(`ID: ${slot.id}`);
      console.log(`  Materi: ${slot.title}`);
      console.log(`  Kelas: ${slot.class_name}`);
      console.log(`  Jam: ${slot.start_time} - ${slot.end_time}`);
      console.log(`  Narasumber: ${slot.narasumber_name || '(belum ditugaskan)'}`);
      console.log('');
    });

    // Cek yang jam 16:50-17:50
    const [conflict] = await db.query(`
      SELECT
        ss.id,
        ss.slot_date,
        ss.start_time,
        ss.end_time,
        c.name as class_name,
        t.title,
        u.name as narasumber_name
      FROM schedule_slots ss
      JOIN schedule_slot_classes ssc ON ssc.schedule_slot_id=ss.id
      JOIN classes c ON c.id=ssc.class_id
      LEFT JOIN tasks t ON t.id=ss.task_id
      LEFT JOIN users u ON u.id=ssc.narasumber_id
      WHERE ss.slot_date='2026-06-08'
        AND TIME(ss.start_time)='16:50:00'
      ORDER BY c.name
    `);

    if (conflict.length) {
      console.log('=== SLOT JAM 16:50 ===\n');
      conflict.forEach(row => {
        console.log(`Kelas: ${row.class_name}`);
        console.log(`Jam: ${row.start_time} - ${row.end_time}`);
        console.log(`Materi: ${row.title}`);
        console.log(`Narasumber: ${row.narasumber_name}`);
        console.log('');
      });
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

checkSchedule();
