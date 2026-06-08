const db = require('./config/db');

async function debugAssignNarasumber() {
  try {
    // Simulasi: assign seraga ke 1B, materi video (task_id tertentu)
    // Cari task video di 1B
    const [videoTasks1B] = await db.query(`
      SELECT t.id, t.title, t.class_id
      FROM tasks t
      WHERE t.class_id IN (SELECT id FROM classes WHERE name IN ('1A', '1B'))
        AND t.title LIKE '%Video%'
        AND t.phase IN ('OJC', 'ISC2')
        AND t.task_type = 'UPLOAD'
      ORDER BY t.class_id, t.title
    `);

    console.log('\n=== TASK VIDEO di 1A dan 1B ===');
    videoTasks1B.forEach(t => {
      console.log(`Task ID: ${t.id}, Kelas: ${t.class_id}, Judul: ${t.title}`);
    });

    if (videoTasks1B.length < 2) {
      console.log('Tidak cukup data. Coba cari tasks lain...');
      const [allTasks] = await db.query(`
        SELECT t.id, t.title, t.class_id, c.name as class_name
        FROM tasks t
        JOIN classes c ON c.id = t.class_id
        WHERE c.name IN ('1A', '1B')
          AND t.phase IN ('OJC', 'ISC2')
          AND t.task_type = 'UPLOAD'
        LIMIT 10
      `);
      console.log('\n=== ALL TASKS di 1A dan 1B ===');
      allTasks.forEach(t => {
        console.log(`Task ID: ${t.id}, Kelas: ${t.class_name}, Judul: ${t.title}`);
      });
      return;
    }

    // Ambil task video dari 1B
    const videoTask1B = videoTasks1B.find(t => t.class_id === (videoTasks1B[0].class_id === 1 ? 2 : 1));
    const videoTask1A = videoTasks1B.find(t => t.class_id === (videoTasks1B[0].class_id === 1 ? 1 : 2));

    if (!videoTask1B || !videoTask1A) {
      console.log('Task video di 1A atau 1B tidak ditemukan');
      return;
    }

    console.log(`\n=== Simulasi: Assign ke 1B, Task Video (ID: ${videoTask1B.id}) ===`);

    // Query targetSlots saat assign ke 1B
    const [targetSlots] = await db.query(`
      SELECT ss.id, ss.task_id, ss.slot_date, ss.start_time, ss.end_time, c.id as class_id, c.name AS class_name
      FROM schedule_slots ss
      JOIN schedule_slot_classes ssc ON ssc.schedule_slot_id=ss.id
      JOIN classes c ON c.id=ssc.class_id
      WHERE ssc.class_id=? AND ss.task_id IN (${videoTask1B.id})
      GROUP BY ss.id, ss.task_id, ss.slot_date, ss.start_time, ss.end_time, c.name
    `, [videoTask1B.class_id || 2]); // Assuming 1B is class_id 2

    console.log('\nTarget Slots (untuk 1B, Video):');
    targetSlots.forEach(slot => {
      console.log(`  Slot ID: ${slot.id}, Task: ${slot.task_id}, Jam: ${slot.start_time}-${slot.end_time}, Kelas: ${slot.class_name}`);
    });

    // Query otherSlots
    const narasumberId = 1; // Assuming seraga is user_id 1
    const [otherSlots] = await db.query(`
      SELECT ss.id, ss.slot_date, ss.start_time, ss.end_time, c.id AS class_id, c.name AS class_name
      FROM schedule_slot_classes ssc
      JOIN schedule_slots ss ON ss.id=ssc.schedule_slot_id
      JOIN classes c ON c.id=ssc.class_id
      WHERE ssc.narasumber_id=? AND ssc.class_id<>?
      GROUP BY ss.id, ss.slot_date, ss.start_time, ss.end_time, c.id, c.name
    `, [narasumberId, videoTask1B.class_id || 2]);

    console.log('\nOther Slots (seraga di kelas LAIN):');
    otherSlots.forEach(slot => {
      console.log(`  Slot ID: ${slot.id}, Jam: ${slot.start_time}-${slot.end_time}, Kelas: ${slot.class_name}`);
    });

    // Cek overlap
    console.log('\n=== Cek Overlap ===');
    let hasOverlap = false;
    for (const ns of targetSlots) {
      for (const ex of otherSlots) {
        if (String(ns.slot_date) !== String(ex.slot_date)) {
          console.log(`Date berbeda: ${ns.slot_date} vs ${ex.slot_date}`);
          continue;
        }
        const overlap = ns.start_time < ex.end_time && ns.end_time > ex.start_time;
        console.log(`${ns.start_time} < ${ex.end_time} && ${ns.end_time} > ${ex.start_time} = ${overlap}`);
        if (overlap) {
          console.log(`  ❌ OVERLAP: Task ${ns.task_id} (${ns.class_name} ${ns.start_time}-${ns.end_time}) vs Kelas ${ex.class_name} (${ex.start_time}-${ex.end_time})`);
          hasOverlap = true;
        }
      }
    }

    if (!hasOverlap) {
      console.log('✅ Tidak ada overlap');
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    console.error(e);
    process.exit(1);
  }
}

debugAssignNarasumber();
