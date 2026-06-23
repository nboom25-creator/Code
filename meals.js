// Meal dataset — all recipes are FISH/SEAFOOD-FREE and ALLIUM-FREE
// (no onion, scallion, chive, shallot, leek, or garlic; no fish sauce/shrimp paste).
// Quantities are the BASELINE for 2 servings. Scale with: qty * (servings / 2).
// `discrete: true` => round to whole units when scaling (eggs, cans, tortillas...).
// category: Produce | Proteins | Pantry

const MEALS = [
  {
    id: "rigatoni-herb-chicken",
    name: "Tuscan Tomato-Basil Rigatoni with Herb Chicken",
    cuisine: "Italian-American",
    minutes: 35,
    ingredients: [
      { name: "fresh basil leaves", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "celery, finely minced", qty: 1, unit: "stalk", category: "Produce", discrete: true },
      { name: "chicken breast", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "rigatoni", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "heavy cream", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "fennel seed", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "red pepper flakes", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Boil salted water; cook rigatoni to al dente (~11 min). Reserve ½ cup pasta water, drain.",
      "Season chicken with salt and pepper. Sear in 1 tbsp oil over medium-high 5–6 min to 165°F; remove.",
      "Add remaining oil, grated carrot, celery, fennel seed, oregano; cook 3–4 min.",
      "Stir in tomato paste and pepper flakes 1 min; add crushed tomatoes + salt, simmer 8 min.",
      "Stir in cream and Parmesan. Return chicken; add pasta and chopped basil, loosening with pasta water.",
      "Finish with torn basil and extra Parmesan."
    ]
  },
  {
    id: "fajita-bowls",
    name: "Sheet-Pan Chili-Lime Chicken Fajita Bowls",
    cuisine: "Tex-Mex",
    minutes: 30,
    ingredients: [
      { name: "red bell pepper", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "yellow bell pepper", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "zucchini", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "chicken thighs, sliced", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.25, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 425°F. Cook rice per package.",
      "Whisk oil, cumin, paprika, chili powder, oregano, salt, pepper, lime zest + half the juice.",
      "Toss chicken, peppers, zucchini in the mix; spread on a sheet pan.",
      "Roast 20–22 min, tossing once, until chicken hits 165°F and edges char.",
      "Build bowls over rice; top with avocado, cilantro, remaining lime."
    ]
  },
  {
    id: "pad-krapow",
    name: "Thai Basil Chicken (Pad Krapow) over Jasmine Rice",
    cuisine: "Thai",
    minutes: 25,
    ingredients: [
      { name: "Thai basil leaves", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lemongrass, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "Thai chili, minced", qty: 1.5, unit: "whole", category: "Produce", discrete: true },
      { name: "red bell pepper, diced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground chicken", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "eggs", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "coconut aminos", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dark soy sauce", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice; keep warm.",
      "Stir together soy sauce, coconut aminos, dark soy, brown sugar.",
      "Stir-fry ginger, lemongrass, chilies in 1 tbsp oil over high 30 sec.",
      "Add chicken; stir-fry 5–6 min. Add bell pepper 2 min. Add sauce, toss 1 min; fold in basil off heat.",
      "Fry eggs crispy in remaining oil. Serve chicken over rice, topped with an egg."
    ]
  },
  {
    id: "meatloaf",
    name: "Classic Glazed Meatloaf with Mashed Potatoes & Green Beans",
    cuisine: "American",
    minutes: 60,
    ingredients: [
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "celery, finely minced", qty: 1, unit: "stalk", category: "Produce", discrete: true },
      { name: "Yukon Gold potatoes", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "green beans, trimmed", qty: 8, unit: "oz", category: "Produce", discrete: false },
      { name: "ground beef (80/20)", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "egg", qty: 1, unit: "whole", category: "Proteins", discrete: true },
      { name: "breadcrumbs", qty: 0.333, unit: "cup", category: "Pantry", discrete: false },
      { name: "milk (for loaf)", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ketchup", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "yellow mustard", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "Worcestershire (anchovy-free)", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "butter", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "milk (for potatoes)", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Soak breadcrumbs in milk 2 min.",
      "Mix beef, egg, carrot, celery, paprika, Worcestershire, salt, pepper, soaked crumbs; shape into a loaf.",
      "Brush with ketchup + brown sugar + mustard. Bake 40–45 min to 160°F; rest 5 min.",
      "Boil potatoes 15 min; mash with butter, milk, salt, pepper.",
      "Steam green beans 4–5 min; toss with butter and salt."
    ]
  },
  {
    id: "enchiladas",
    name: "Beef & Black Bean Enchiladas with Red Chili Sauce",
    cuisine: "Mexican",
    minutes: 45,
    ingredients: [
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "black beans (canned)", qty: 0.75, unit: "cup", category: "Proteins", discrete: false },
      { name: "corn tortillas", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "crushed tomatoes", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "shredded cheese", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "vegetable broth", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Toast tomato paste + spices in 1 tbsp oil 1 min; add tomatoes, broth, salt; simmer 10 min.",
      "Brown beef in 1 tbsp oil 6–7 min; stir in beans and ⅓ cup sauce.",
      "Warm tortillas, fill with beef and cheese, roll seam-down in a dish.",
      "Top with remaining sauce and cheese; bake 18–20 min until bubbly.",
      "Finish with cilantro and lime."
    ]
  },
  {
    id: "eggplant-parm",
    name: "Eggplant Parmesan with Spaghetti",
    cuisine: "Italian-American",
    minutes: 50,
    ingredients: [
      { name: "eggplant", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "fresh basil leaves", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "eggs", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "spaghetti", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "Italian breadcrumbs", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "shredded mozzarella", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "fennel seed", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Salt eggplant rounds, rest 15 min, pat dry. Heat oven to 400°F.",
      "Bread slices: egg wash, then crumbs + ¼ cup Parmesan. Bake on oiled pan 20 min, flipping once.",
      "Sauce: cook carrot, oregano, fennel in oil 3 min; add paste 1 min, tomatoes + salt; simmer 10 min; add half the basil.",
      "Layer sauce, eggplant, mozzarella in a dish; bake 12–15 min.",
      "Serve over spaghetti with remaining Parmesan and basil."
    ]
  },
  {
    id: "coconut-curry",
    name: "Thai Coconut Chicken Curry with Potatoes",
    cuisine: "Thai",
    minutes: 40,
    ingredients: [
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lemongrass, minced", qty: 1, unit: "stalk", category: "Produce", discrete: true },
      { name: "Yukon Gold potatoes, cubed", qty: 2, unit: "medium", category: "Produce", discrete: true },
      { name: "red bell pepper, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "chicken thighs, cubed", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "full-fat coconut milk", qty: 13.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "red curry powder", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "ground coriander", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "ground turmeric", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice; keep warm.",
      "Bloom ginger, lemongrass in oil 1 min; add curry powder, coriander, turmeric 30 sec.",
      "Brown chicken 4–5 min; add coconut milk, soy, brown sugar, salt.",
      "Add potatoes, simmer covered 15 min; add pepper, simmer 8–10 min to 165°F.",
      "Off heat stir in lime; serve over rice with cilantro."
    ]
  },
  {
    id: "chicken-parm",
    name: "Chicken Parmesan with Spaghetti",
    cuisine: "Italian-American",
    minutes: 45,
    ingredients: [
      { name: "fresh basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "chicken breast, pounded thin", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "eggs", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "spaghetti", qty: 8, unit: "oz", category: "Pantry", discrete: false },
      { name: "Italian breadcrumbs", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "shredded mozzarella", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 400°F. Bread chicken: egg wash, then crumbs + ¼ cup Parmesan.",
      "Pan-fry in oil 3 min per side until golden; transfer to a baking dish.",
      "Quick sauce: cook carrot + oregano in oil 3 min, add paste 1 min, tomatoes + salt; simmer 10 min.",
      "Top chicken with sauce and mozzarella; bake 12–15 min to 165°F.",
      "Serve over spaghetti with basil and remaining Parmesan."
    ]
  },
  {
    id: "bbq-pulled-chicken",
    name: "BBQ Pulled Chicken Sliders with Crunchy Slaw",
    cuisine: "American",
    minutes: 40,
    ingredients: [
      { name: "green cabbage, shredded", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, shredded", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "chicken thighs", qty: 14, unit: "oz", category: "Proteins", discrete: false },
      { name: "slider buns", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "tomato ketchup", qty: 0.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "apple cider vinegar", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "ground mustard", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "mayonnaise", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Simmer chicken in water with ½ tsp salt 18–20 min to 165°F; shred.",
      "Make sauce: ketchup, vinegar, brown sugar, paprika, mustard; simmer 5 min. Toss with chicken.",
      "Slaw: cabbage, carrot, mayo, pinch salt and a splash of vinegar.",
      "Pile chicken on buns, top with slaw."
    ]
  },
  {
    id: "beef-tacos",
    name: "Spiced Beef Tacos with Cabbage-Lime Slaw",
    cuisine: "Tex-Mex",
    minutes: 30,
    ingredients: [
      { name: "green cabbage, shredded", qty: 2, unit: "cup", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 3, unit: "tbsp", category: "Produce", discrete: false },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "corn tortillas", qty: 6, unit: "whole", category: "Pantry", discrete: true },
      { name: "ground cumin", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "chili powder", qty: 1.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Brown beef in oil 6 min; add cumin, chili powder, paprika, oregano, tomato paste, salt + ¼ cup water; simmer 5 min.",
      "Slaw: cabbage, cilantro, lime juice, pinch salt.",
      "Warm tortillas; fill with beef, slaw, and avocado. Squeeze lime."
    ]
  },
  {
    id: "thai-peanut-noodles",
    name: "Thai Peanut Noodles with Chicken",
    cuisine: "Thai",
    minutes: 30,
    ingredients: [
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "carrot, julienned", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "red bell pepper, sliced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "chicken breast, sliced", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "rice noodles", qty: 6, unit: "oz", category: "Pantry", discrete: false },
      { name: "creamy peanut butter", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "rice vinegar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "crushed peanuts", qty: 2, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Soak/cook rice noodles per package; drain.",
      "Whisk peanut butter, soy, brown sugar, vinegar, lime juice, 3 tbsp warm water.",
      "Stir-fry ginger in oil 30 sec; add chicken 5–6 min; add carrot and pepper 2 min.",
      "Add noodles and sauce; toss to coat. Top with peanuts and cilantro."
    ]
  },
  {
    id: "stuffed-peppers",
    name: "Cheesy Beef & Rice Stuffed Bell Peppers",
    cuisine: "American",
    minutes: 55,
    ingredients: [
      { name: "bell peppers, halved", qty: 3, unit: "whole", category: "Produce", discrete: true },
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "fresh parsley, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "cooked rice", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "tomato paste", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "shredded cheese", qty: 1, unit: "cup", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Brown beef in oil 6 min with carrot, paprika, oregano, salt.",
      "Stir in rice, crushed tomatoes, tomato paste; simmer 3 min.",
      "Fill pepper halves; top with cheese. Bake 30–35 min until peppers are tender.",
      "Finish with parsley."
    ]
  },
  {
    id: "baked-ziti",
    name: "Baked Ziti with Herbed Ricotta",
    cuisine: "Italian-American",
    minutes: 50,
    ingredients: [
      { name: "fresh basil leaves", qty: 0.5, unit: "cup", category: "Produce", discrete: false },
      { name: "carrot, finely grated", qty: 1, unit: "medium", category: "Produce", discrete: true },
      { name: "ground beef or Italian-seasoned pork", qty: 10, unit: "oz", category: "Proteins", discrete: false },
      { name: "ricotta cheese", qty: 1, unit: "cup", category: "Proteins", discrete: false },
      { name: "ziti", qty: 10, unit: "oz", category: "Pantry", discrete: false },
      { name: "crushed tomatoes", qty: 14.5, unit: "oz can", category: "Pantry", discrete: true },
      { name: "tomato paste", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "shredded mozzarella", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "grated Parmesan", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "fennel seed", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "dried oregano", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Heat oven to 375°F. Cook ziti 2 min shy of al dente; drain.",
      "Brown meat in oil with carrot, fennel, oregano, salt 6 min; add paste 1 min, tomatoes; simmer 10 min.",
      "Mix ricotta with Parmesan and chopped basil.",
      "Layer pasta, sauce, ricotta dollops, mozzarella in a dish; bake 25 min until bubbly and golden."
    ]
  },
  {
    id: "chicken-quesadillas",
    name: "Green-Chile Chicken Quesadillas",
    cuisine: "Mexican",
    minutes: 30,
    ingredients: [
      { name: "fresh cilantro, chopped", qty: 2, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lime", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "avocado", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "cooked shredded chicken", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "flour tortillas (large)", qty: 4, unit: "whole", category: "Pantry", discrete: true },
      { name: "canned diced green chiles", qty: 4, unit: "oz can", category: "Pantry", discrete: true },
      { name: "shredded cheese", qty: 1.5, unit: "cup", category: "Pantry", discrete: false },
      { name: "ground cumin", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "smoked paprika", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "sour cream", qty: 0.25, unit: "cup", category: "Pantry", discrete: false }
    ],
    steps: [
      "Toss chicken with green chiles, cumin, paprika.",
      "Fill tortillas with chicken and cheese; fold.",
      "Cook in oiled skillet over medium 2–3 min per side until golden and melty.",
      "Slice; serve with avocado, sour cream, cilantro, lime."
    ]
  },
  {
    id: "pork-chops-apples",
    name: "Pan-Seared Pork Chops with Skillet Apples & Mash",
    cuisine: "American",
    minutes: 40,
    ingredients: [
      { name: "apples, sliced", qty: 2, unit: "whole", category: "Produce", discrete: true },
      { name: "Yukon Gold potatoes", qty: 1, unit: "lb", category: "Produce", discrete: false },
      { name: "fresh thyme", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "bone-in pork chops", qty: 2, unit: "whole", category: "Proteins", discrete: true },
      { name: "butter", qty: 3, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "milk", qty: 0.25, unit: "cup", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "apple cider vinegar", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "olive oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "kosher salt", qty: 0.75, unit: "tsp", category: "Pantry", discrete: false },
      { name: "black pepper", qty: 0.5, unit: "tsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Boil potatoes 15 min; mash with butter, milk, salt, pepper.",
      "Season chops with salt and pepper. Sear in oil over medium-high 4 min per side to 145°F; rest.",
      "In the same pan, melt 1 tbsp butter; cook apples with thyme, brown sugar, vinegar 5 min until glazed.",
      "Serve chops over mash, spooned with apples."
    ]
  },
  {
    id: "thai-basil-beef",
    name: "Ginger-Lemongrass Thai Basil Beef Bowls",
    cuisine: "Thai",
    minutes: 25,
    ingredients: [
      { name: "Thai basil leaves", qty: 1, unit: "cup", category: "Produce", discrete: false },
      { name: "fresh ginger, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "lemongrass, minced", qty: 1, unit: "tbsp", category: "Produce", discrete: false },
      { name: "green beans, cut", qty: 6, unit: "oz", category: "Produce", discrete: false },
      { name: "Thai chili, minced", qty: 1, unit: "whole", category: "Produce", discrete: true },
      { name: "ground beef", qty: 12, unit: "oz", category: "Proteins", discrete: false },
      { name: "jasmine rice (dry)", qty: 0.75, unit: "cup", category: "Pantry", discrete: false },
      { name: "soy sauce", qty: 2, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "coconut aminos", qty: 1, unit: "tbsp", category: "Pantry", discrete: false },
      { name: "brown sugar", qty: 1, unit: "tsp", category: "Pantry", discrete: false },
      { name: "neutral oil", qty: 1, unit: "tbsp", category: "Pantry", discrete: false }
    ],
    steps: [
      "Cook jasmine rice; keep warm.",
      "Stir-fry ginger, lemongrass, chili in oil 30 sec.",
      "Add beef; brown 6 min. Add green beans 3 min.",
      "Add soy, coconut aminos, brown sugar; toss 1 min. Fold in basil off heat; serve over rice."
    ]
  }
];

if (typeof module !== "undefined") module.exports = { MEALS };
