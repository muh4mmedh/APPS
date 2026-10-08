/*
 * data.js — the four gym days and the knee rehab list.
 *
 * Exercise fields
 *   id      stable key; logged sets are stored under it, so never rename one
 *   art     key into GymFigures.ART
 *   sets    how many sets
 *   reps    the target as shown, e.g. "8-12 reps"; the numbers in it are the
 *           range the app aims for
 *   log     what a set records: "wr" weight and reps (default), "reps" reps
 *           only, "secs" or "mins" a duration
 */
(function () {
  'use strict';

  var DAYS = [
    { id: "d1", name: "Day 1", tag: "Chest", title: "Day 1: Chest + shoulders", ex: [
      { id: "incline-db", art: "incline", name: "Incline dumbbell press", sets: 3, reps: "8-12 reps",
        steps: ["Set the bench to a low incline, about 30 degrees.", "Sit back, feet flat, shoulder blades pulled together and down.", "Lower the dumbbells to the sides of your upper chest, elbows about 45 degrees from your body.", "Press up and slightly inward until your arms are straight, without locking hard."],
        avoid: ["Bench too steep, which turns it into a shoulder press.", "Flaring elbows straight out to the sides.", "Bouncing the weights off your chest."],
        knee: "Keep your feet planted. No leg drive that twists the knee." },
      { id: "flat-press", art: "flat", name: "Flat dumbbell or machine press", sets: 3, reps: "8-12 reps",
        steps: ["Lie back with eyes under the handles or dumbbells, feet flat.", "Squeeze your shoulder blades together and keep them there.", "Lower slowly until your elbows are just below chest level.", "Press up in a smooth line, exhale as you push."],
        avoid: ["Lifting your hips off the bench.", "Going so heavy the reps get short and fast."],
        knee: "Feet flat and still. Do not tuck or swing your legs." },
      { id: "lat-raise-1", art: "lateral", name: "Dumbbell lateral raise", sets: 3, reps: "12-15 reps",
        steps: ["Stand tall with light dumbbells at your sides, slight bend in the elbows.", "Raise your arms out to the sides until your hands reach shoulder height.", "Lead with your elbows, not your hands.", "Lower over 2 to 3 seconds."],
        avoid: ["Swinging your body to get the weight up.", "Shrugging the shoulders toward your ears.", "Going heavy. This one works best light."],
        knee: "Stand with a soft knee bend, not locked.", imgNote: "Shown from the front." },
      { id: "ohp", art: "ohp", name: "Overhead dumbbell press", sets: 3, reps: "8-12 reps",
        steps: ["Sit on a bench with back support, dumbbells at shoulder height.", "Brace your stomach and keep your ribs down.", "Press straight up until your arms are almost straight.", "Lower back to ear level with control."],
        avoid: ["Arching your lower back hard.", "Letting the dumbbells drift far in front of you."],
        knee: "Seated is better for the knee than standing here." },
      { id: "fly", art: "fly", name: "Cable or machine fly", sets: 3, reps: "12 reps",
        steps: ["Set the handles at about chest height and keep a slight bend in your elbows.", "Bring your hands together in a wide hugging arc.", "Squeeze your chest for one second at the front.", "Open back slowly until you feel a stretch, not pain."],
        avoid: ["Turning it into a press by bending the elbows more.", "Letting the stack slam down between reps."],
        knee: "Use a staggered stance, but keep your weight steady and avoid twisting.", imgNote: "Shown from the front." }
    ]},
    { id: "d2", name: "Day 2", tag: "Back", title: "Day 2: Back + biceps", ex: [
      { id: "pulldown", art: "pulldown", name: "Lat pulldown", sets: 3, reps: "8-12 reps",
        steps: ["Grip the bar a little wider than your shoulders and sit with thighs secured under the pad.", "Lean back slightly, chest up.", "Pull the bar to your upper chest by driving your elbows down and back.", "Let the bar rise slowly until your arms are straight."],
        avoid: ["Pulling the bar behind your neck.", "Leaning way back and yanking with momentum.", "Shrugging your shoulders up."],
        knee: "Adjust the thigh pad snug so your knees are not pushed or twisted." },
      { id: "row", art: "row", name: "Seated cable row", sets: 3, reps: "8-12 reps",
        steps: ["Sit tall with a slight bend in your knees and feet on the plates.", "Pull the handle to your lower ribs, elbows close to your body.", "Squeeze your shoulder blades together for one second.", "Return slowly and let your shoulders reach forward a little."],
        avoid: ["Rocking your torso back and forth.", "Rounding your lower back at the stretch."],
        knee: "Keep a gentle bend. Do not push the knees straight and locked." },
      { id: "face-pull", art: "facepull", name: "Face pull", sets: 3, reps: "15 reps",
        steps: ["Set the cable at about face height with a rope attachment.", "Pull the rope toward your face, hands splitting apart at the end.", "Finish with elbows high and your hands beside your ears.", "Hold for a beat, then return slowly."],
        avoid: ["Going heavy and leaning back to cheat.", "Pulling to your chest instead of your face."],
        knee: "Stand with feet shoulder width and steady." },
      { id: "curl", art: "curl", name: "Dumbbell curl", sets: 3, reps: "8-12 reps",
        steps: ["Stand with elbows pinned to your sides, palms forward.", "Curl up without moving your elbows forward.", "Squeeze at the top.", "Lower over 2 to 3 seconds until your arms are almost straight."],
        avoid: ["Swinging your back to lift the weight.", "Letting your elbows drift forward."],
        knee: "Stand with a soft knee bend, or sit on a bench if standing bothers it." },
      { id: "hammer", art: "curl", name: "Hammer curl", sets: 3, reps: "10-12 reps",
        steps: ["Hold the dumbbells with palms facing each other, like holding a hammer.", "Keep your elbows by your sides.", "Curl up toward your shoulders without twisting your wrists.", "Lower slowly."],
        avoid: ["Using momentum from your hips.", "Dropping the weights fast on the way down."],
        knee: "Same as dumbbell curl. Sitting is fine.", imgNote: "Same path as the curl, but your palms face each other." }
    ]},
    { id: "d3", name: "Day 3", tag: "Legs", title: "Day 3: Legs + core", ex: [
      { id: "leg-press", art: "legpress", name: "Leg press (light)", sets: 3, reps: "12 reps",
        steps: ["Sit with your back flat against the pad and feet shoulder width on the plate.", "Lower slowly until your knees reach about 90 degrees, no deeper.", "Push through your whole foot, not just your toes.", "Stop just short of locking your knees at the top."],
        avoid: ["Going deep so your lower back rounds off the pad.", "Locking your knees hard at the top.", "Letting your knees cave inward."],
        knee: "Keep it light and slow. Knees should track over your toes. Stop if you feel anything sharp." },
      { id: "ham-curl", art: "hamcurl", name: "Hamstring curl", sets: 3, reps: "12 reps",
        steps: ["Set the pad just above your heels and line your knee with the machine's pivot.", "Curl your heels toward your glutes in a smooth motion.", "Pause for one second at the top.", "Lower over 3 seconds."],
        avoid: ["Lifting your hips off the pad.", "Dropping the weight fast on the way back."],
        knee: "Strong hamstrings protect the ACL, so this is a key lift. Go slow and light." },
      { id: "bridge", art: "bridge", name: "Glute bridge", sets: 3, reps: "12 reps", log: "reps",
        steps: ["Lie on your back with knees bent and feet flat, hip width apart.", "Push through your heels and lift your hips until your body is a straight line from shoulder to knee.", "Squeeze your glutes at the top for one second.", "Lower with control."],
        avoid: ["Arching your lower back to get higher.", "Pushing through your toes."],
        knee: "Keep your knees pointing straight ahead, not falling inward." },
      { id: "calf", art: "calf", name: "Calf raise", sets: 3, reps: "15 reps",
        steps: ["Stand with the balls of your feet on a step or machine pad.", "Rise as high as you can on your toes.", "Pause at the top.", "Lower slowly until you feel a stretch."],
        avoid: ["Bouncing at the bottom.", "Rolling your ankles outward."],
        knee: "Keep your knees almost straight but not locked." },
      { id: "plank", art: "plank", name: "Plank", sets: 3, reps: "30-45 seconds", log: "secs",
        steps: ["Rest on your forearms with elbows under your shoulders.", "Make a straight line from head to heels.", "Squeeze your stomach and glutes.", "Breathe steadily. End the set when your form breaks."],
        avoid: ["Letting your hips sag.", "Pushing your hips up high.", "Holding your breath."],
        knee: "If the knees on the floor bother you, use a mat or do it on a bench." },
      { id: "cardio-3", art: "bike", name: "Bike or flat walk", sets: 1, reps: "20 minutes", log: "mins",
        steps: ["Set the seat so your knee has a slight bend at the bottom of each pedal turn.", "Keep a steady pace where you can still talk in short sentences.", "Use a flat treadmill or very slight incline if walking."],
        avoid: ["Running or jogging for now.", "Setting the seat too low, which bends the knee too much."],
        knee: "Low resistance, smooth pedaling. No standing sprints." }
    ]},
    { id: "d4", name: "Day 4", tag: "Upper", title: "Day 4: Upper mix", ex: [
      { id: "chest-press-4", art: "flat", name: "Chest press (dumbbell or machine)", sets: 3, reps: "8-12 reps",
        steps: ["Set the seat so the handles line up with the middle of your chest.", "Pull your shoulder blades back and keep your chest up.", "Press forward until your arms are almost straight.", "Return slowly until you feel a stretch across your chest."],
        avoid: ["Shrugging your shoulders up.", "Letting your elbows flare wide."],
        knee: "Feet flat and still.", imgNote: "Picture shows the dumbbell version on a flat bench." },
      { id: "lat-raise-4", art: "lateral", name: "Dumbbell lateral raise", sets: 3, reps: "12-15 reps",
        steps: ["Stand tall with light dumbbells at your sides.", "Raise your arms out to shoulder height, leading with your elbows.", "Pause briefly at the top.", "Lower slowly."],
        avoid: ["Swinging to get the weight up.", "Going too heavy."],
        knee: "Soft knee bend, steady stance.", imgNote: "Shown from the front." },
      { id: "bar-curl", art: "curl", name: "Barbell or cable curl", sets: 3, reps: "8-12 reps",
        steps: ["Grip the bar shoulder width, palms up, elbows at your sides.", "Curl up without letting your elbows travel forward.", "Squeeze your biceps at the top.", "Lower over 2 to 3 seconds."],
        avoid: ["Leaning back to swing the bar up.", "Cutting the range short at the bottom."],
        knee: "Stand tall with a soft knee bend." },
      { id: "pushdown", art: "pushdown", name: "Triceps pushdown", sets: 3, reps: "10-12 reps",
        steps: ["Stand close to the cable with elbows pinned to your sides.", "Push the handle down until your arms are straight.", "Squeeze your triceps for a beat.", "Let the handle rise until your forearms are about parallel to the floor."],
        avoid: ["Letting your elbows float forward.", "Leaning your whole body over the bar."],
        knee: "Feet shoulder width, no twisting." },
      { id: "core-4", art: "hanging", name: "Cable crunch or hanging knee raise", sets: 3, reps: "10-15 reps",
        steps: ["Cable crunch: kneel under a rope, hold it by your head, and curl your ribs toward your hips.", "Move by rounding your spine, not by sitting back on your heels.", "Hanging knee raise: hang from the bar and lift your knees toward your chest without swinging.", "Lower with control."],
        avoid: ["Pulling with your arms instead of your stomach.", "Swinging your body on the hanging version."],
        knee: "Kneeling puts pressure on the knee. Use a pad, or pick the hanging version, or skip it if the knee complains.", imgNote: "Picture shows the hanging version." }
    ]},
    { id: "k", name: "Rehab", tag: "Knee", title: "Knee rehab", note: "Do these 2 to 3 times a week after your main lifts, or on rest days. Go slow and keep it pain free. Ask your doctor or physio when running and direction changes are safe to restart.", ex: [
      { id: "slr", art: "slr", name: "Straight leg raise", sets: 3, reps: "12 reps (sore leg)", log: "reps",
        steps: ["Lie on your back with the sore leg straight and the other knee bent, foot flat.", "Tighten the thigh first so the knee is fully straight.", "Lift the straight leg to the height of the bent knee, about 30 cm.", "Hold for 1 second, then lower slowly."],
        avoid: ["Letting the knee bend as you lift.", "Arching your lower back.", "Swinging the leg up with momentum."],
        knee: "If you can't keep the knee straight while lifting, stop and mention it to your physio." },
      { id: "tke", art: "tke", name: "Terminal knee extension (band)", sets: 3, reps: "15 reps", log: "reps",
        steps: ["Anchor a resistance band at knee height in front of you.", "Loop it behind the sore knee and step back until the band is snug.", "Start with a slight knee bend.", "Straighten the knee fully while squeezing the front of your thigh, hold for 1 second, then bend back slowly."],
        avoid: ["Snapping the knee back hard.", "Using a band so strong that your hips shift.", "Leaning back to cheat."],
        knee: "Straighten fully but gently. No snapping or forcing it." },
      { id: "balance", art: "balance", name: "Single-leg balance", sets: 3, reps: "30 seconds", log: "secs",
        steps: ["Stand on the sore leg next to a wall or rail.", "Keep a soft knee bend and level hips.", "Hold for 30 seconds with your eyes open.", "When it feels easy, stand on a folded towel or cushion."],
        avoid: ["Gripping the wall hard.", "Locking the knee or letting it cave inward.", "Holding your breath."],
        knee: "Keep your kneecap over your second toe. Touch the rail if you feel wobbly." },
      { id: "stepup", art: "stepup", name: "Low step-up", sets: 3, reps: "10 each leg", log: "reps",
        steps: ["Use a low step, about 10 to 15 cm.", "Place your whole foot on the step.", "Push through the heel of the top foot and stand up tall.", "Lower slowly and with control."],
        avoid: ["Pushing off the back foot.", "Letting the knee fall inward.", "Dropping fast on the way down."],
        knee: "Only do these if the knee feels stable. Stop if it wobbles or hurts." },
      { id: "legext", art: "legext", name: "Seated leg extension (light)", sets: 3, reps: "12 reps",
        steps: ["Line your knee up with the machine's pivot and set the pad on your shin above the ankle.", "Extend the leg to almost straight, in a short range.", "Squeeze your thigh for 1 second.", "Lower slowly over about 3 seconds."],
        avoid: ["Going heavy.", "Kicking up with momentum.", "Locking the knee hard at the top."],
        knee: "Very light weight, short range. Stop if you feel pain at the front of the knee." }
    ]}
  ];

  window.GYM_DAYS = DAYS;
})();
